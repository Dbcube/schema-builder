/**
 * Regresiones de `table:refresh` contra un PostgreSQL de verdad.
 *
 * Reproduce el escenario que documento el equipo de dbtrix (HALLAZGOS-DBCUBE.md)
 * y que dejaba un esquema a medias sin que nadie se enterase:
 *
 *   1. refresh decia "N applied" y no creaba ninguna tabla.
 *   2. una columna boolean con defaultValue generaba DEFAULT 0, que PostgreSQL
 *      rechaza, y ese era justo el fallo que quedaba oculto por (1).
 *   3. una FK autorreferente colocaba las tablas dependientes ANTES que ella.
 *
 * Necesita Docker. Levanta y tira su propio contenedor:
 *   node test/integration/refresh-regressions.cjs
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CONTAINER = 'dbcube-refresh-regressions';
const PORT = 55498;
const MONO = path.resolve(__dirname, '..', '..', '..'); // raiz del monorepo

let pass = 0, fail = 0;
const ok = (cond, label, detail) => {
    if (cond) { console.log('  ✔ ' + label); pass++; }
    else { console.log('  ✘ ' + label + (detail ? '\n      ' + detail : '')); fail++; }
};

const docker = (args, opts = {}) => spawnSync('docker', args, { encoding: 'utf8', ...opts });

const psql = (sql) =>
    docker(['exec', CONTAINER, 'psql', '-U', 'dbc', '-d', 'control', '-tAc', sql]).stdout.trim();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function startPostgres() {
    docker(['rm', '-f', CONTAINER]);
    const up = docker(['run', '-d', '--name', CONTAINER,
        '-e', 'POSTGRES_USER=dbc', '-e', 'POSTGRES_PASSWORD=dbcpw', '-e', 'POSTGRES_DB=control',
        '-p', PORT + ':5432', 'postgres:16-alpine']);
    if (up.status !== 0) throw new Error('no se pudo levantar postgres: ' + up.stderr);

    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
        if (docker(['exec', CONTAINER, 'pg_isready', '-U', 'dbc']).status === 0) return;
        await sleep(1000);
    }
    throw new Error('postgres no acepto conexiones a tiempo');
}

/** Proyecto temporal con los paquetes locales ya compilados superpuestos. */
function makeProject(cubes) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dbcube-refresh-'));
    fs.writeFileSync(path.join(root, 'package.json'),
        JSON.stringify({ name: 'refresh-regressions', version: '1.0.0', private: true }));
    fs.writeFileSync(path.join(root, 'dbcube.config.js'),
        'module.exports = function (config) {\n' +
        '  config.set({ databases: { control: { type: "postgres", config: {\n' +
        '    HOST: "127.0.0.1", PORT: ' + PORT + ', USER: "dbc", PASSWORD: "dbcpw", DATABASE: "control"\n' +
        '  } } } });\n};\n');

    const cubesDir = path.join(root, 'dbcube', 'cubes');
    fs.mkdirSync(cubesDir, { recursive: true });
    for (const [name, body] of Object.entries(cubes)) {
        fs.writeFileSync(path.join(cubesDir, name + '.table.cube'), body);
    }

    // Paquetes del monorepo (dist ya compilado) + el CLI por codigo fuente.
    const nm = path.join(root, 'node_modules');
    for (const pkg of ['core', 'query-builder', 'schema-builder']) {
        const dest = path.join(nm, '@dbcube', pkg);
        fs.mkdirSync(dest, { recursive: true });
        fs.cpSync(path.join(MONO, pkg, 'package.json'), path.join(dest, 'package.json'));
        fs.cpSync(path.join(MONO, pkg, 'dist'), path.join(dest, 'dist'), { recursive: true });
    }
    fs.mkdirSync(path.join(nm, 'dbcube'), { recursive: true });
    fs.cpSync(path.join(MONO, 'orm', 'package.json'), path.join(nm, 'dbcube', 'package.json'));
    fs.cpSync(path.join(MONO, 'orm', 'dist'), path.join(nm, 'dbcube', 'dist'), { recursive: true });
    fs.mkdirSync(path.join(nm, '@dbcube', 'cli'), { recursive: true });
    fs.cpSync(path.join(MONO, 'cli', 'src'), path.join(nm, '@dbcube', 'cli', 'src'), { recursive: true });
    fs.cpSync(path.join(MONO, 'cli', 'package.json'), path.join(nm, '@dbcube', 'cli', 'package.json'));

    // Engine de esquemas ya compilado, con el nombre versionado que espera el loader.
    const binDir = path.join(root, '.dbcube', 'bin');
    fs.mkdirSync(binDir, { recursive: true });
    const binName = process.platform === 'win32'
        ? 'schema-engine-windows-x64.exe'
        : 'schema-engine-linux-x64';
    const src = path.join(MONO, 'schema-engine', 'binaries', binName);
    if (!fs.existsSync(src)) throw new Error('falta el binario del schema-engine: ' + src);
    fs.copyFileSync(src, path.join(binDir, binName.replace(/^schema-engine-/, 'schema-engine-v2.1.0-')));

    return root;
}

function runCli(root, args) {
    const cliEntry = path.join(root, 'node_modules', '@dbcube', 'cli', 'src', 'index.js');
    return spawnSync(process.execPath, [cliEntry, ...args], {
        cwd: root,
        encoding: 'utf8',
        env: {
            ...process.env,
            NODE_PATH: [
                path.join(MONO, 'cli', 'node_modules'),
                path.join(MONO, 'core', 'node_modules'),
            ].join(path.delimiter),
        },
    });
}

const PK = '  id: { type: "int"; options: ["primary", "autoincrement"]; };';
const cube = (name, cols) =>
    '@database("control");\n@meta({ name: "' + name + '"; });\n@columns({\n' + cols + '\n});\n';

(async () => {
    console.log('\ntable:refresh — regresiones contra PostgreSQL real\n');
    await startPostgres();

    let root;
    try {
        root = makeProject({
            // boolean con defaultValue: generaba DEFAULT 0 y reventaba en Postgres
            engines: cube('engines', PK +
                '\n  name: { type: "varchar"; length: "60"; options: ["not null"]; };' +
                '\n  is_available: { type: "boolean"; defaultValue: "false"; options: ["not null"]; };'),
            // FK autorreferente: descolocaba a databases y a sus dependientes
            databases: cube('databases', PK +
                '\n  db_ref: { type: "varchar"; length: "60"; options: ["not null"]; };' +
                '\n  id_parent_database: { type: "int"; foreign: { table: "databases"; column: "id"; }; };'),
            // depende de databases: tiene que crearse DESPUES
            backups: cube('backups', PK +
                '\n  id_database: { type: "int"; options: ["not null"]; foreign: { table: "databases"; column: "id"; }; };'),
        });

        const res = runCli(root, ['run', 'table:refresh', '--all']);
        const salida = (res.stdout || '') + (res.stderr || '');
        if (process.env.DBCUBE_TEST_DEBUG) {
            console.log('--- salida del CLI ---\n' + salida + '\n---');
        }

        const orden = JSON.parse(
            fs.readFileSync(path.join(root, '.dbcube', 'orderexecute.json'), 'utf8')).tables;
        ok(orden.indexOf('databases') < orden.indexOf('backups'),
            'la tabla autorreferente se crea antes que quienes la referencian',
            'orden: ' + orden.join(' -> '));

        const tablas = psql(
            "select table_name from information_schema.tables where table_schema='public' order by 1")
            .split('\n').map((s) => s.trim()).filter(Boolean);

        ok(['backups', 'databases', 'engines'].every((t) => tablas.includes(t)),
            'las 3 tablas existen de verdad en PostgreSQL',
            'encontradas: ' + tablas.join(', '));

        const aplicadas = (salida.match(/(\d+)\s+applied/) || [])[1];
        ok(aplicadas === '3' && tablas.length >= 3,
            'lo que reporta el CLI coincide con lo que hay en la base',
            'reporto ' + aplicadas + ' applied y hay ' + tablas.length + ' tablas');

        const porDefecto = psql(
            "select column_default from information_schema.columns " +
            "where table_name='engines' and column_name='is_available'");
        ok(/false/i.test(porDefecto),
            'el default de una columna boolean es FALSE, no 0',
            'default = ' + JSON.stringify(porDefecto));

        // Y lo mas importante: un fallo real NO puede reportarse como exito.
        // Se anade un .cube que no puede crearse (FK a una tabla inexistente).
        fs.writeFileSync(path.join(root, 'dbcube', 'cubes', 'roto.table.cube'),
            cube('roto', PK + '\n  ref: { type: "int"; foreign: { table: "no_existe"; column: "id"; }; };'));

        const res2 = runCli(root, ['run', 'table:refresh', '--all']);
        const salida2 = (res2.stdout || '') + (res2.stderr || '');
        ok(!/ 4 applied/.test(salida2),
            'una tabla que no puede crearse NO se cuenta como aplicada',
            salida2.replace(/\s+/g, ' ').slice(0, 220));
        ok(/error/i.test(salida2),
            'el fallo se reporta al usuario en vez de tragarselo',
            salida2.replace(/\s+/g, ' ').slice(0, 220));

        const existeRota = psql(
            "select count(*) from information_schema.tables " +
            "where table_schema='public' and table_name='roto'");
        ok(existeRota === '0', 'la tabla rota efectivamente no existe', 'count = ' + existeRota);

    } finally {
        docker(['rm', '-f', CONTAINER]);
        if (root) fs.rmSync(root, { recursive: true, force: true });
    }

    console.log('\n' + (fail === 0
        ? 'ALL GREEN — ' + pass + ' comprobaciones'
        : fail + ' FALLO(S) de ' + (pass + fail)) + '\n');
    process.exit(fail === 0 ? 0 : 1);
})().catch((e) => {
    spawnSync('docker', ['rm', '-f', CONTAINER]);
    console.error('EXCEPCION:', e);
    process.exit(1);
});
