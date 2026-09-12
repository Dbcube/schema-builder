/**
 * DependencyResolver: orden de creacion de tablas.
 *
 * Regresion de un fallo real: una FK a la PROPIA tabla (jerarquias del estilo
 * id_parent_database -> id) hacia que Kahn tratase la tabla como parte de un
 * ciclo. Su grado de entrada nunca llegaba a 0, caia en la rama de respaldo y,
 * peor, arrastraba ahi a TODAS las tablas que dependian de ella: se creaban
 * antes que ella y la FK fallaba.
 *
 *   node test/dependency-order.cjs
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const { DependencyResolver } = require('../dist/index.cjs');

let pass = 0, fail = 0;
const ok = (cond, label, detail) => {
    if (cond) { console.log('  \u2714 ' + label); pass++; }
    else { console.log('  \u2718 ' + label + (detail ? '\n      ' + detail : '')); fail++; }
};

/** Escribe un proyecto temporal con los .table.cube dados y devuelve el orden. */
function orderFor(tables) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dbcube-order-'));
    const cubesDir = path.join(root, 'dbcube');
    fs.mkdirSync(cubesDir, { recursive: true });

    const files = [];
    for (const [name, columns] of Object.entries(tables)) {
        const file = path.join(cubesDir, name + '.table.cube');
        fs.writeFileSync(file,
            '@database("app");\n' +
            '@meta({ name: "' + name + '"; });\n' +
            '@columns({\n' + columns + '\n});\n');
        files.push(file);
    }

    const prev = process.cwd();
    process.chdir(root);
    try {
        return DependencyResolver.resolveDependencies(files, 'table').tables;
    } finally {
        process.chdir(prev);
        fs.rmSync(root, { recursive: true, force: true });
    }
}

const PK = '  id: { type: "int"; options: ["primary", "autoincrement"]; };';
const fk = (col, table) =>
    '  ' + col + ': { type: "int"; foreign: { table: "' + table + '"; column: "id"; }; };';

const before = (order, a, b) => order.indexOf(a) < order.indexOf(b);

console.log('\nDependencyResolver \u2014 orden de creacion\n');

{
    // EL caso: databases se referencia a si misma y backups depende de ella.
    const order = orderFor({
        backups:   PK + '\n' + fk('id_database', 'databases'),
        databases: PK + '\n' + fk('id_parent_database', 'databases'),
        engines:   PK,
    });
    ok(before(order, 'databases', 'backups'),
        'una FK autorreferente no descoloca a la tabla ni a sus dependientes',
        'orden: ' + order.join(' -> '));
    ok(order.length === 3 && new Set(order).size === 3,
        'aparecen las 3 tablas, sin duplicados', order.join(' -> '));
}

{
    // Cadena normal: no debe haberse roto nada.
    const order = orderFor({
        c: PK + '\n' + fk('id_b', 'b'),
        b: PK + '\n' + fk('id_a', 'a'),
        a: PK,
    });
    ok(before(order, 'a', 'b') && before(order, 'b', 'c'),
        'una cadena a <- b <- c mantiene su orden', 'orden: ' + order.join(' -> '));
}

{
    // Autorreferencia sola, sin nadie que dependa de ella.
    const order = orderFor({ nodes: PK + '\n' + fk('id_parent', 'nodes') });
    ok(order.length === 1 && order[0] === 'nodes',
        'una tabla que solo se referencia a si misma se resuelve', order.join(' -> '));
}

{
    // Un ciclo de verdad (a -> b -> a) sigue cayendo en la rama de respaldo sin
    // perder tablas: es un esquema que el usuario debe arreglar, no un crash.
    const order = orderFor({
        a: PK + '\n' + fk('id_b', 'b'),
        b: PK + '\n' + fk('id_a', 'a'),
    });
    ok(order.length === 2 && new Set(order).size === 2,
        'un ciclo real no pierde ni duplica tablas', order.join(' -> '));
}

{
    // Varias tablas colgando de la autorreferente: todas despues de ella.
    const order = orderFor({
        api_keys:       PK + '\n' + fk('id_database', 'databases'),
        backups:        PK + '\n' + fk('id_database', 'databases'),
        database_users: PK + '\n' + fk('id_database', 'databases'),
        databases:      PK + '\n' + fk('id_parent_database', 'databases'),
    });
    const dependents = ['api_keys', 'backups', 'database_users'];
    ok(dependents.every((t) => before(order, 'databases', t)),
        'todos los dependientes van despues de la tabla autorreferente',
        'orden: ' + order.join(' -> '));
}

console.log('\n' + (fail === 0
    ? 'ALL GREEN \u2014 ' + pass + ' comprobaciones'
    : fail + ' FALLO(S) de ' + (pass + fail)) + '\n');
process.exit(fail === 0 ? 0 : 1);
