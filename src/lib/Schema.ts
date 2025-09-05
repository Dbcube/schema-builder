import fs from 'fs';
import { Engine, TableProcessor, Config as ConfigClass } from "@dbcube/core";
import path from 'path';
import FileUtils from './FileUtils';
import chalk from 'chalk';
import { UIUtils, ProcessSummary, ProcessError } from './UIUtils';

/**
 * Main class to handle MySQL database connections and queries.
 * Implements the Singleton pattern to ensure a single instance of the connection pool.
 */
class Schema {
    private name: string;
    private engine: any;

    constructor(name: string) {
        this.name = name;
        this.engine = new Engine(name);
    }

    /**
     * Validates that the database specified in cube file exists in configuration
     * @param filePath - Path to the cube file
     * @returns true if valid, throws error if invalid
     */
    private validateDatabaseConfiguration(filePath: string): { isValid: boolean; error?: ProcessError } {
        try {
            // Extract database name from cube file
            const dbResult = FileUtils.extractDatabaseNameFromCube(filePath);
            if (dbResult.status !== 200) {
                return {
                    isValid: false,
                    error: {
                        itemName: path.basename(filePath, path.extname(filePath)),
                        error: `Error reading database directive: ${dbResult.message}`,
                        filePath,
                        lineNumber: this.findDatabaseLineNumber(filePath)
                    }
                };
            }

            const cubeDbName = dbResult.message;

            // Get available configurations
            const configInstance = new ConfigClass();
            const configFilePath = path.resolve(process.cwd(), 'dbcube.config.js');
            const configFn = require(configFilePath);

            if (typeof configFn === 'function') {
                configFn(configInstance);
            } else {
                throw new Error('❌ The dbcube.config.js file does not export a function.');
            }

            // Check if the database configuration exists
            const dbConfig = configInstance.getDatabase(cubeDbName);
            if (!dbConfig) {
                // Try to get available databases by attempting to access common ones
                let availableDbs: string[] = [];
                try {
                    // Try some common database names to see what exists
                    const testNames = ['test', 'development', 'production', 'local', 'main'];
                    for (const testName of testNames) {
                        try {
                            const testConfig = configInstance.getDatabase(testName);
                            if (testConfig) {
                                availableDbs.push(testName);
                            }
                        } catch (e) {
                            // Skip non-existent configs
                        }
                    }
                } catch (e) {
                    // Fallback if we can't determine available databases
                }

                const availableText = availableDbs.length > 0 ? availableDbs.join(', ') : 'none found';
                return {
                    isValid: false,
                    error: {
                        itemName: path.basename(filePath, path.extname(filePath)),
                        error: `Database configuration '${cubeDbName}' not found in dbcube.config.js. Available: ${availableText}`,
                        filePath,
                        lineNumber: this.findDatabaseLineNumber(filePath)
                    }
                };
            }

            return { isValid: true };

        } catch (error: any) {
            return {
                isValid: false,
                error: {
                    itemName: path.basename(filePath, path.extname(filePath)),
                    error: `Database configuration validation failed: ${error.message}`,
                    filePath,
                    lineNumber: this.findDatabaseLineNumber(filePath)
                }
            };
        }
    }

    /**
     * Finds the line number where @database directive is located
     */
    private findDatabaseLineNumber(filePath: string): number {
        try {
            const content = fs.readFileSync(filePath, 'utf8');
            const lines = content.split('\n');
            for (let i = 0; i < lines.length; i++) {
                if (lines[i].includes('@database')) {
                    return i + 1; // Line numbers start at 1
                }
            }
            return 1;
        } catch {
            return 1;
        }
    }

    async createDatabase(): Promise<any> {
        const startTime = Date.now();
        const rootPath = path.resolve(process.cwd());

        // Show header
        UIUtils.showOperationHeader(' CREATING DATABASE', this.name, '🗄️');

        // Show progress for database creation
        await UIUtils.showItemProgress('Preparando e instalando base de datos', 1, 1);

        try {
            const response = await this.engine.run('schema_engine', [
                '--action', 'create_database',
                '--path', rootPath,
            ]);

            if (response.status != 200) {
                returnFormattedError(response.status, response.message);
            }

            UIUtils.showItemSuccess('Database');

            // Show final summary
            const summary: ProcessSummary = {
                startTime,
                totalProcessed: 1,
                successCount: 1,
                errorCount: 0,
                processedItems: [this.name],
                operationName: 'create database',
                databaseName: this.name,
                errors: []
            };
            UIUtils.showOperationSummary(summary);

            return response.data;

        } catch (error: any) {
            UIUtils.showItemError('Database', error.message);
            const summary: ProcessSummary = {
                startTime,
                totalProcessed: 0,
                successCount: 0,
                errorCount: 1,
                processedItems: [],
                operationName: 'create database',
                databaseName: this.name,
                errors: []
            };
            UIUtils.showOperationSummary(summary);
            throw error;
        }
    }

    async refreshTables(): Promise<any> {
        const startTime = Date.now();
        const cubesDir = path.join(process.cwd(), 'dbcube', 'cubes');

        // Verificar si la carpeta existe
        if (!fs.existsSync(cubesDir)) {
            throw new Error('❌ The cubes folder does not exist');
        }

        const cubeFiles = FileUtils.getCubeFilesRecursively('dbcube', 'table.cube');
        if (cubeFiles.length === 0) {
            throw new Error('❌ There are no cubes to execute');
        }

        // Show header
        UIUtils.showOperationHeader('EXECUTING REFRESH TABLES', this.name, '🔄');

        let totalTablesProcessed = 0;
        let successCount = 0;
        let errorCount = 0;
        const processedTables: string[] = [];
        const errors: ProcessError[] = [];

        for (let index = 0; index < cubeFiles.length; index++) {
            const file = cubeFiles[index];
            const filePath = path.isAbsolute(file) ? file : path.join(cubesDir, file);
            const stats = fs.statSync(filePath);

            if (stats.isFile()) {
                const getTableName = FileUtils.extracTableNameFromCube(filePath);
                const tableName = getTableName.status === 200 ? getTableName.message : path.basename(file, '.table.cube');

                // Show visual progress for each table
                await UIUtils.showItemProgress(tableName, index + 1, cubeFiles.length);

                try {
                    // Validate database configuration before processing
                    const validation = this.validateDatabaseConfiguration(filePath);
                    if (!validation.isValid && validation.error) {
                        UIUtils.showItemError(tableName, validation.error.error);
                        errors.push(validation.error);
                        errorCount++;
                        continue;
                    }

                    const dml = await this.engine.run('schema_engine', [
                        '--action', 'parse_table',
                        '--mode', 'refresh',
                        '--schema-path', filePath,
                    ]);
                    if (dml.status != 200) {
                        returnFormattedError(dml.status, dml.message);
                        break;
                    }
                    const parseJson = JSON.stringify(dml.data.actions).replace(/[\r\n\t]/g, '').replace(/\\[rnt]/g, '').replace(/\s{2,}/g, ' ');

                    const queries = await this.engine.run('schema_engine', [
                        '--action', 'generate',
                        '--mode', 'refresh',
                        '--dml', parseJson,
                    ]);
                    if (queries.status != 200) {
                        returnFormattedError(queries.status, queries.message);
                        break;
                    }
                    delete queries.data.database_type;

                    const parseJsonQueries = JSON.stringify(queries.data);

                    const response = await this.engine.run('schema_engine', [
                        '--action', 'execute',
                        '--mode', 'refresh',
                        '--dml', parseJsonQueries,
                    ]);

                    if (response.status != 200) {
                        returnFormattedError(response.status, response.message);
                        break;
                    }
                    const createQuery = queries.data.regular_queries.filter((q: string) => q.includes("CREATE"))[0];

                    await TableProcessor.saveQuery(dml.data.table, dml.data.database, createQuery);

                    UIUtils.showItemSuccess(tableName);
                    successCount++;
                    processedTables.push(tableName);
                    totalTablesProcessed++;

                } catch (error: any) {
                    const processError: ProcessError = {
                        itemName: tableName,
                        error: error.message,
                        filePath
                    };
                    UIUtils.showItemError(tableName, error.message);
                    errors.push(processError);
                    errorCount++;
                }
            }
        }

        // Show final summary
        const summary: ProcessSummary = {
            startTime,
            totalProcessed: totalTablesProcessed,
            successCount,
            errorCount,
            processedItems: processedTables,
            operationName: 'refresh tables',
            databaseName: this.name,
            errors
        };
        UIUtils.showOperationSummary(summary);

        return totalTablesProcessed > 0 ? { processed: totalTablesProcessed, success: successCount, errors: errorCount } : null;
    }

    async freshTables(): Promise<any> {
        const startTime = Date.now();
        const cubesDir = path.join(process.cwd(), 'dbcube', 'cubes');

        // Verificar si la carpeta existe
        if (!fs.existsSync(cubesDir)) {
            throw new Error('❌ The cubes folder does not exist');
        }

        const cubeFiles = FileUtils.getCubeFilesRecursively('dbcube', 'table.cube');
        if (cubeFiles.length === 0) {
            throw new Error('❌ There are no cubes to execute');
        }

        // Show header
        UIUtils.showOperationHeader('EXECUTING FRESH TABLES', this.name);

        let totalTablesProcessed = 0;
        let successCount = 0;
        let errorCount = 0;
        const processedTables: string[] = [];
        const errors: ProcessError[] = [];

        for (let index = 0; index < cubeFiles.length; index++) {
            const file = cubeFiles[index];
            const filePath = path.isAbsolute(file) ? file : path.join(cubesDir, file);
            const stats = fs.statSync(filePath);

            if (stats.isFile()) {
                const getTableName = FileUtils.extracTableNameFromCube(filePath);
                const tableName = getTableName.status === 200 ? getTableName.message : path.basename(file, '.table.cube');

                // Show visual progress for each table
                await UIUtils.showItemProgress(tableName, index + 1, cubeFiles.length);

                try {
                    // Validate database configuration before processing
                    const validation = this.validateDatabaseConfiguration(filePath);
                    if (!validation.isValid && validation.error) {
                        UIUtils.showItemError(tableName, validation.error.error);
                        errors.push(validation.error);
                        errorCount++;
                        continue;
                    }

                    const dml = await this.engine.run('schema_engine', [
                        '--action', 'parse_table',
                        '--schema-path', filePath,
                        '--mode', 'fresh',
                    ]);

                    if (dml.status != 200) {
                        returnFormattedError(dml.status, dml.message);
                        break;
                    }

                    const parseJson = JSON.stringify(dml.data.actions).replace(/[\r\n\t]/g, '').replace(/\\[rnt]/g, '').replace(/\s{2,}/g, ' ');

                    const queries = await this.engine.run('schema_engine', [
                        '--action', 'generate',
                        '--dml', parseJson,
                    ]);

                    if (queries.status != 200) {
                        returnFormattedError(queries.status, queries.message);
                        break;
                    }

                    delete queries.data._type;
                    const createQuery = queries.data.regular_queries.filter((q: string) => q.includes("CREATE"))[0];

                    // For fresh mode, use the generated queries directly without alterations
                    // generateAlterQueries is used for refresh mode, not fresh mode

                    const parseJsonQueries = JSON.stringify(queries.data);

                    const response = await this.engine.run('schema_engine', [
                        '--action', 'execute',
                        '--mode', 'fresh',
                        '--dml', parseJsonQueries,
                    ]);

                    if (response.status != 200) {
                        returnFormattedError(response.status, response.message);
                        break;
                    }

                    await TableProcessor.saveQuery(dml.data.table, dml.data.database, createQuery);

                    UIUtils.showItemSuccess(tableName);
                    successCount++;
                    processedTables.push(tableName);
                    totalTablesProcessed++;

                } catch (error: any) {
                    const processError: ProcessError = {
                        itemName: tableName,
                        error: error.message,
                        filePath
                    };
                    UIUtils.showItemError(tableName, error.message);
                    errors.push(processError);
                    errorCount++;
                }
            }
        }

        // Show final summary
        const summary: ProcessSummary = {
            startTime,
            totalProcessed: totalTablesProcessed,
            successCount,
            errorCount,
            processedItems: processedTables,
            operationName: 'fresh tables',
            databaseName: this.name,
            errors
        };
        UIUtils.showOperationSummary(summary);

        return totalTablesProcessed > 0 ? { processed: totalTablesProcessed, success: successCount, errors: errorCount } : null;
    }


    async executeSeeders(): Promise<any> {
        const startTime = Date.now();
        const cubesDir = path.join(process.cwd(), 'dbcube', 'cubes');

        // Verificar si la carpeta existe
        if (!fs.existsSync(cubesDir)) {
            throw new Error('❌ The cubes folder does not exist');
        }

        const cubeFiles = FileUtils.getCubeFilesRecursively('dbcube', 'seeder.cube');

        if (cubeFiles.length === 0) {
            throw new Error('❌ There are no cubes to execute');
        }

        // Show header
        UIUtils.showOperationHeader('EXECUTING SEEDERS', this.name, '🌱');

        let totalSeedersProcessed = 0;
        let successCount = 0;
        let errorCount = 0;
        const processedSeeders: string[] = [];
        const errors: ProcessError[] = [];

        for (let index = 0; index < cubeFiles.length; index++) {
            const file = cubeFiles[index];
            const filePath = path.isAbsolute(file) ? file : path.join(cubesDir, file);
            const stats = fs.statSync(filePath);

            if (stats.isFile()) {
                const getSeederName = FileUtils.extracTableNameFromCube(filePath);
                const seederName = getSeederName.status === 200 ? getSeederName.message : path.basename(file, '.seeder.cube');

                // Show visual progress for each seeder
                await UIUtils.showItemProgress(seederName, index + 1, cubeFiles.length);

                try {
                    // Validate database configuration before processing
                    const validation = this.validateDatabaseConfiguration(filePath);
                    if (!validation.isValid && validation.error) {
                        UIUtils.showItemError(seederName, validation.error.error);
                        errors.push(validation.error);
                        errorCount++;
                        continue;
                    }

                    const response = await this.engine.run('schema_engine', [
                        '--action', 'seeder',
                        '--schema-path', filePath,
                    ]);

                    if (response.status != 200) {
                        returnFormattedError(response.status, response.message);
                        break;
                    }

                    UIUtils.showItemSuccess(seederName);
                    successCount++;
                    processedSeeders.push(seederName);
                    totalSeedersProcessed++;

                } catch (error: any) {
                    const processError: ProcessError = {
                        itemName: seederName,
                        error: error.message,
                        filePath
                    };
                    UIUtils.showItemError(seederName, error.message);
                    errors.push(processError);
                    errorCount++;
                }
            }
        }

        // Show final summary
        const summary: ProcessSummary = {
            startTime,
            totalProcessed: totalSeedersProcessed,
            successCount,
            errorCount,
            processedItems: processedSeeders,
            operationName: 'seeders',
            databaseName: this.name,
            errors
        };
        UIUtils.showOperationSummary(summary);

        return totalSeedersProcessed > 0 ? { processed: totalSeedersProcessed, success: successCount, errors: errorCount } : null;
    }

    async executeTriggers(): Promise<any> {
        const startTime = Date.now();
        const cubesDir = path.join(process.cwd(), 'dbcube', 'cubes');
        const triggersDirExit = path.join(process.cwd(), 'dbcube', 'triggers');

        // Verificar si la carpeta existe
        if (!fs.existsSync(cubesDir)) {
            throw new Error('❌ The cubes folder does not exist');
        }

        const cubeFiles = FileUtils.getCubeFilesRecursively('dbcube', 'trigger.cube');

        if (cubeFiles.length === 0) {
            throw new Error('❌ There are no cubes to execute');
        }

        // Show header
        UIUtils.showOperationHeader('EXECUTING TRIGGERS', this.name, '⚡');

        let totalTriggersProcessed = 0;
        let successCount = 0;
        let errorCount = 0;
        const processedTriggers: string[] = [];
        const errors: ProcessError[] = [];

        for (let index = 0; index < cubeFiles.length; index++) {
            const file = cubeFiles[index];
            const filePath = path.isAbsolute(file) ? file : path.join(cubesDir, file);
            const stats = fs.statSync(filePath);

            if (stats.isFile()) {
                const getTriggerName = FileUtils.extracTableNameFromCube(filePath);
                const triggerName = getTriggerName.status === 200 ? getTriggerName.message : path.basename(file, '.trigger.cube');

                // Show visual progress for each trigger
                await UIUtils.showItemProgress(triggerName, index + 1, cubeFiles.length);

                try {
                    // Validate database configuration before processing
                    const validation = this.validateDatabaseConfiguration(filePath);
                    if (!validation.isValid && validation.error) {
                        UIUtils.showItemError(triggerName, validation.error.error);
                        errors.push(validation.error);
                        errorCount++;
                        continue;
                    }

                    const response = await this.engine.run('schema_engine', [
                        '--action', 'trigger',
                        '--path-exit', triggersDirExit,
                        '--schema-path', filePath,
                    ]);

                    if (response.status != 200) {
                        returnFormattedError(response.status, response.message);
                        break;
                    }

                    UIUtils.showItemSuccess(triggerName);
                    successCount++;
                    processedTriggers.push(triggerName);
                    totalTriggersProcessed++;

                } catch (error: any) {
                    const processError: ProcessError = {
                        itemName: triggerName,
                        error: error.message,
                        filePath
                    };
                    UIUtils.showItemError(triggerName, error.message);
                    errors.push(processError);
                    errorCount++;
                }
            }
        }

        // Show final summary
        const summary: ProcessSummary = {
            startTime,
            totalProcessed: totalTriggersProcessed,
            successCount,
            errorCount,
            processedItems: processedTriggers,
            operationName: 'triggers',
            databaseName: this.name,
            errors
        };
        UIUtils.showOperationSummary(summary);

        return totalTriggersProcessed > 0 ? { processed: totalTriggersProcessed, success: successCount, errors: errorCount } : null;
    }
}


function returnFormattedError(status: number, message: string) {
    console.log(`\n${chalk.red('🚫')} ${chalk.bold.red('ERRORS FOUND')}`);
    console.log(chalk.red('─'.repeat(60)));

    // Show error with [error] tag format
    console.log(`${chalk.red('[error]')} ${chalk.red(message)}`);
    console.log('');

    const err = new Error();
    const stackLines = err.stack?.split('\n') || [];

    // Find the first stack line outside of node_modules
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

            // Show code location with [code] tag format
            console.log(`${chalk.cyan('[code]')} ${chalk.yellow(errorLocation)}`);

            // Show code context
            try {
                const codeLines = fs.readFileSync(filePath, 'utf-8').split('\n');
                const start = Math.max(0, lineNum - 3);
                const end = Math.min(codeLines.length, lineNum + 2);

                for (let i = start; i < end; i++) {
                    const line = codeLines[i];
                    const lineLabel = `${i + 1}`.padStart(4, ' ');
                    const pointer = i + 1 === lineNum ? `${chalk.red('<-')}` : '  ';
                    console.log(`${chalk.gray(lineLabel)} ${pointer}       ${chalk.white(line)}`);
                }
            } catch (err) {
                console.log(chalk.gray('   (unable to show code context)'));
            }
        }
    }

    console.log('');

    process.exit(1);
}

export default Schema;
export { Schema };