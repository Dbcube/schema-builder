import fs from 'fs';
import { Engine, TableProcessor } from "@dbcube/core";
import path from 'path';
import FileUtils from './FileUtils';

/**
 * Main class to handle MySQL database connections and queries.
 * Implements the Singleton pattern to ensure a single instance of the connection pool.
 */
class Schema {
    private name: string;
    private engine: any;

    constructor(name: string) {
        this.name = name; 
        const engine = new Engine(name);
        this.engine = engine;
    }

    async createDatabase(): Promise<any> {
        const rootPath = path.resolve(process.cwd());
        const response =  await this.engine.run('schema_engine',[
            '--action', 'create_database',
            '--path', rootPath,
        ]);
        if(response.status!=200){
            returnFormattedError(response.status, response.message);
        }
        return response.data;
    }

    async refreshTables(): Promise<any> {
        const cubesDir = path.join(process.cwd(), 'dbcube', 'cubes');
        
        // Verificar si la carpeta existe
        if (!fs.existsSync(cubesDir)) {
            throw new Error('❌ The cubes folder does not exist');
        }

        const cubeFiles = FileUtils.getCubeFilesRecursively('dbcube', 'table.cube');
        if (cubeFiles.length === 0) {
            throw new Error('❌ There are no cubes to execute');
        } else {  
            for (const file of cubeFiles) {
                const filePath = path.isAbsolute(file) ? file : path.join(cubesDir, file);
                const stats = fs.statSync(filePath);
                if (stats.isFile()) {
                    const dml =  await this.engine.run('schema_engine',[
                        '--action', 'parse_table',
                        '--mode', 'refresh',
                        '--schema-path', filePath,
                    ]);
                    if(dml.status!=200){
                        returnFormattedError(dml.status, dml.message);
                    }
                    const parseJson = JSON.stringify(dml.data.actions).replace(/[\r\n\t]/g, '').replace(/\\[rnt]/g, '').replace(/\s{2,}/g, ' '); 

                    const queries =  await this.engine.run('schema_engine',[
                        '--action', 'generate',
                        '--mode', 'refresh',
                        '--dml', parseJson,
                    ]);
                    if(queries.status!=200){
                        returnFormattedError(queries.status, queries.message);
                    }
                    delete queries.data.database_type;
                    
                    const parseJsonQueries = JSON.stringify(queries.data); 

                    const response =  await this.engine.run('schema_engine',[
                        '--action', 'execute',
                        '--mode', 'refresh',
                        '--dml', parseJsonQueries,
                    ]);

                    if(response.status!=200){
                        returnFormattedError(response.status, response.message);
                    }
                    const createQuery = queries.data.regular_queries.filter((q:string) => q.includes("CREATE"))[0];
                    
                    await TableProcessor.saveQuery(dml.data.table, dml.data.database, createQuery);

                    return response.data;
                    
                }
            }
        }
        return null;
    }

    async freshTables(): Promise<any> {
        const cubesDir = path.join(process.cwd(), 'dbcube', 'cubes');
        
        // Verificar si la carpeta existe
        if (!fs.existsSync(cubesDir)) {
            throw new Error('❌ The cubes folder does not exist');
        }

        const cubeFiles = FileUtils.getCubeFilesRecursively('dbcube', 'table.cube');
        if (cubeFiles.length === 0) {
            throw new Error('❌ There are no cubes to execute');
        } else {  
            for (const file of cubeFiles) {
                const filePath = path.isAbsolute(file) ? file : path.join(cubesDir, file);
                const stats = fs.statSync(filePath);
                if (stats.isFile()) {
                    const dml =  await this.engine.run('schema_engine',[
                        '--action', 'parse_table',
                        '--schema-path', filePath,
                        '--mode', 'fresh',
                    ]);
                    if(dml.status!=200){
                        returnFormattedError(dml.status, dml.message);
                    }
                    const parseJson = JSON.stringify(dml.data.actions).replace(/[\r\n\t]/g, '').replace(/\\[rnt]/g, '').replace(/\s{2,}/g, ' '); 

                    const queries =  await this.engine.run('schema_engine',[
                        '--action', 'generate',
                        '--dml', parseJson,
                    ]);
                    if(queries.status!=200){
                        returnFormattedError(queries.status, queries.message);
                    }
                    delete queries.data. _type;
                        
                    const createQuery = queries.data.regular_queries.filter((q:string) => q.includes("CREATE"))[0];
                    
                    if(queries.data.regular_queries.length>0){
                        const nowQueries = await TableProcessor.generateAlterQueries(queries.data.regular_queries[0], dml.data.motor, dml.data.table, dml.data.database);
                        queries.data.regular_queries = nowQueries;
                    }

                    const parseJsonQueries = JSON.stringify(queries.data); 

                    const response =  await this.engine.run('schema_engine',[
                        '--action', 'execute',
                        '--mode', 'fresh',
                        '--dml', parseJsonQueries,
                    ]);

                    if(response.status!=200){
                        returnFormattedError(response.status, response.message);
                    }
                    
                    await TableProcessor.saveQuery(dml.data.table, dml.data.database, createQuery);

                    return response.data;
                    
                }
            }
        }
        return null;
    }

    async executeSeeders(): Promise<any> {
        const cubesDir = path.join(process.cwd(), 'dbcube', 'cubes');
        
        // Verificar si la carpeta existe
        if (!fs.existsSync(cubesDir)) {
            throw new Error('❌ The cubes folder does not exist');
        }

        const cubeFiles = FileUtils.getCubeFilesRecursively('dbcube', 'seeder.cube');

        if (cubeFiles.length === 0) {
            throw new Error('❌ There are no cubes to execute');
        } else {  
            for (const file of cubeFiles) {
                const filePath = path.isAbsolute(file) ? file : path.join(cubesDir, file);
                const stats = fs.statSync(filePath);
                
                if (stats.isFile()) {

                    const response =  await this.engine.run('schema_engine',[
                        '--action', 'seeder',
                        '--schema-path', filePath,
                    ]);

                    if(response.status!=200){
                        returnFormattedError(response.status, response.message);
                    }

                    return response.data;
                    
                }
            }
        }
        return null;
    }

    async executeTriggers(): Promise<any> {
        const cubesDir = path.join(process.cwd(), 'dbcube', 'cubes');
        const triggersDirExit = path.join(process.cwd(), 'dbcube', 'triggers');
        
        // Verificar si la carpeta existe
        if (!fs.existsSync(cubesDir)) {
            throw new Error('❌ The cubes folder does not exist');
        }

        const cubeFiles = FileUtils.getCubeFilesRecursively('dbcube', 'trigger.cube');

        if (cubeFiles.length === 0) {
            throw new Error('❌ There are no cubes to execute');
        } else {  
            for (const file of cubeFiles) {
                const filePath = path.isAbsolute(file) ? file : path.join(cubesDir, file);
                const stats = fs.statSync(filePath);
                
                if (stats.isFile()) {

                    const response =  await this.engine.run('schema_engine',[
                        '--action', 'trigger',
                        '--path-exit', triggersDirExit,
                        '--schema-path', filePath,
                    ]);

                    if(response.status!=200){
                        returnFormattedError(response.status, response.message);
                    }

                    return response.data;
                    
                }
            }
        }
        return null;
    }
}


function returnFormattedError(status: number, message: string) {
    const RESET = '\x1b[0m';
    const RED = '\x1b[31m';
    const YELLOW = '\x1b[33m';
    const BOLD = '\x1b[1m';
    const CYAN = '\x1b[36m';
    const GRAY = '\x1b[90m';
    const UNDERLINE = '\x1b[4m';
    const MAGENTA = '\x1b[35m';

    let output = '';
    let help = '';
    const color = status === 600 ? YELLOW : RED;

    
    if (message.includes("[help]")) {
        const parts = message.split("[help]");
        output += `\n${RED}${BOLD}${parts[0]}${RESET}`;
        help += `\n${MAGENTA}${BOLD}[help]${RESET} ${GRAY}${parts[1]}${RESET}\n`;
    } else {
        output += `\n${color}${BOLD}${message}${RESET}\n`;
    }

    const err = new Error();
    const stackLines = err.stack?.split('\n') || [];

    // Buscamos la primera línea del stack fuera de node_modules
    const relevantStackLine = stackLines.find(line => 
        line.includes('.js:') && !line.includes('node_modules')
    );

    if (relevantStackLine) {
        const match = relevantStackLine.match(/\((.*):(\d+):(\d+)\)/) || 
                      relevantStackLine.match(/at (.*):(\d+):(\d+)/);

        if (match) {
            const [, filePath, lineStr, columnStr] = match;
            const lineNum = parseInt(lineStr, 10);
            const errorLocation = `${filePath}:${lineStr}:${columnStr}`;

            // Leemos el archivo y sacamos las líneas relevantes
            try {
                const codeLines = fs.readFileSync(filePath, 'utf-8').split('\n');
                const start = Math.max(0, lineNum - 3);
                const end = Math.min(codeLines.length, lineNum + 2);

                output += `\n${CYAN}${BOLD}[code] ${RESET}${YELLOW} ${UNDERLINE}${errorLocation}${RESET}\n`;

                for (let i = start; i < end; i++) {
                    const line = codeLines[i];
                    const lineLabel = `${i + 1}`.padStart(4, ' ');
                    const pointer = i + 1 === lineNum ? `${RED}<-${RESET}` : '  ';
                    output += `${GRAY}${lineLabel}${RESET} ${pointer} ${line}\n`;
                }
            } catch (err) {
                output += `${YELLOW}⚠️ No se pudo leer el archivo de origen: ${filePath}${RESET}\n`;
                output += `\n${CYAN}${BOLD}Stack Trace:${RESET}\n${stackLines.slice(2).join('\n')}\n`;
            }
        }
    }    
    output += help;
    console.error(output);
    process.exit(1);
}

export default Schema;
export { Schema };
