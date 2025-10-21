import fs from 'fs';
import path from 'path';
import FileUtils from './FileUtils';

export interface TableDependency {
    tableName: string;
    filePath: string;
    dependencies: string[];
}

export interface ExecutionOrder {
    tables: string[];
    seeders: string[];
    timestamp: string;
}

export class DependencyResolver {
    
    /**
     * Resolves table dependencies and creates execution order
     */
    static resolveDependencies(cubeFiles: string[], cubeType: 'table' | 'seeder' = 'table'): ExecutionOrder {
        const tableDependencies = this.extractDependencies(cubeFiles, cubeType);
        const orderedTables = this.topologicalSort(tableDependencies);
        
        const executionOrder: ExecutionOrder = {
            tables: cubeType === 'table' ? orderedTables : [],
            seeders: cubeType === 'seeder' ? orderedTables : [],
            timestamp: new Date().toISOString()
        };

        // Save the execution order file
        this.saveExecutionOrder(executionOrder);
        
        return executionOrder;
    }

    /**
     * Extracts dependencies from cube files
     */
    private static extractDependencies(cubeFiles: string[], cubeType: 'table' | 'seeder'): TableDependency[] {
        const dependencies: TableDependency[] = [];

        for (const file of cubeFiles) {
            // Handle absolute paths and relative paths correctly
            let filePath: string;
            if (path.isAbsolute(file)) {
                filePath = file;
            } else if (fs.existsSync(file)) {
                // File exists in current directory
                filePath = path.resolve(file);
            } else {
                // Try the standard dbcube directory (files are now directly in dbcube folder)
                filePath = path.join(process.cwd(), 'dbcube', file);
            }
            
            try {
                // Extract table name
                const tableNameResult = FileUtils.extracTableNameFromCube(filePath);
                const tableName = tableNameResult.status === 200 ? tableNameResult.message : path.basename(file, `.${cubeType}.cube`);
                
                // Extract foreign key dependencies
                const deps = this.extractForeignKeyReferences(filePath);
                
                dependencies.push({
                    tableName,
                    filePath,
                    dependencies: deps
                });
            } catch (error) {
                console.error(`Error processing ${filePath}:`, error);
            }
        }

        return dependencies;
    }

    /**
     * Extracts foreign key references from a cube file
     */
    private static extractForeignKeyReferences(filePath: string): string[] {
        const dependencies: string[] = [];
        
        try {
            const content = fs.readFileSync(filePath, 'utf8');
            const lines = content.split('\n');
            
            let insideForeignKey = false;
            let braceCount = 0;
            
            for (const line of lines) {
                // Check for foreign key start
                if (/foreign\s*:\s*\{/.test(line)) {
                    insideForeignKey = true;
                    braceCount = 1;
                    
                    // Check if table is on the same line
                    const sameLineMatch = line.match(/table\s*:\s*["']([^"']+)["']/);
                    if (sameLineMatch) {
                        dependencies.push(sameLineMatch[1]);
                        insideForeignKey = false;
                        braceCount = 0;
                    }
                    continue;
                }
                
                if (insideForeignKey) {
                    // Count braces to track if we're still inside the foreign object
                    braceCount += (line.match(/\{/g) || []).length;
                    braceCount -= (line.match(/\}/g) || []).length;
                    
                    // Look for table reference
                    const tableMatch = line.match(/table\s*:\s*["']([^"']+)["']/);
                    if (tableMatch) {
                        dependencies.push(tableMatch[1]);
                    }
                    
                    // If braces are balanced, we're out of the foreign object
                    if (braceCount === 0) {
                        insideForeignKey = false;
                    }
                }
            }
        } catch (error) {
            console.error(`Error reading file ${filePath}:`, error);
        }
        
        return dependencies;
    }

    /**
     * Performs topological sort to determine execution order
     */
    private static topologicalSort(dependencies: TableDependency[]): string[] {
        const graph = new Map<string, string[]>();
        const inDegree = new Map<string, number>();
        const tableMap = new Map<string, TableDependency>();
        
        // Build graph and initialize in-degree
        for (const dep of dependencies) {
            graph.set(dep.tableName, dep.dependencies);
            inDegree.set(dep.tableName, 0);
            tableMap.set(dep.tableName, dep);
        }
        
        // Calculate in-degrees
        for (const dep of dependencies) {
            for (const dependency of dep.dependencies) {
                if (inDegree.has(dependency)) {
                    inDegree.set(dep.tableName, (inDegree.get(dep.tableName) || 0) + 1);
                }
            }
        }
        
        // Kahn's algorithm for topological sorting
        const queue: string[] = [];
        const result: string[] = [];
        
        // Find all nodes with no incoming edges
        for (const [table, degree] of inDegree) {
            if (degree === 0) {
                queue.push(table);
            }
        }
        
        while (queue.length > 0) {
            const current = queue.shift()!;
            result.push(current);
            
            const currentDeps = graph.get(current) || [];
            
            // For each neighbor, reduce in-degree
            for (const neighbor of currentDeps) {
                if (inDegree.has(neighbor)) {
                    const newDegree = (inDegree.get(neighbor) || 0) - 1;
                    inDegree.set(neighbor, newDegree);
                    
                    if (newDegree === 0) {
                        queue.push(neighbor);
                    }
                }
            }
        }
        
        // Check for circular dependencies
        if (result.length !== dependencies.length) {
            // Add remaining tables that weren't processed due to circular dependencies
            for (const dep of dependencies) {
                if (!result.includes(dep.tableName)) {
                    result.push(dep.tableName);
                }
            }
        }
        
        return result;
    }

    /**
     * Saves the execution order to .dbcube/orderexecute.json
     */
    private static saveExecutionOrder(order: ExecutionOrder): void {
        try {
            const projectRoot = process.cwd();
            const dbcubeDir = path.join(projectRoot, '.dbcube');
            const orderFile = path.join(dbcubeDir, 'orderexecute.json');
            
            // Create .dbcube directory if it doesn't exist
            if (!fs.existsSync(dbcubeDir)) {
                fs.mkdirSync(dbcubeDir, { recursive: true });
            }
            
            // Save the order file
            fs.writeFileSync(orderFile, JSON.stringify(order, null, 2), 'utf8');
            
            // Execution order saved silently
        } catch (error) {
            console.error('❌ Failed to save execution order:', error);
        }
    }

    /**
     * Loads the execution order from .dbcube/orderexecute.json
     */
    static loadExecutionOrder(): ExecutionOrder | null {
        try {
            const projectRoot = process.cwd();
            const orderFile = path.join(projectRoot, '.dbcube', 'orderexecute.json');
            
            if (!fs.existsSync(orderFile)) {
                return null;
            }
            
            const content = fs.readFileSync(orderFile, 'utf8');
            return JSON.parse(content);
        } catch (error) {
            console.error('❌ Failed to load execution order:', error);
            return null;
        }
    }

    /**
     * Orders cube files based on saved execution order
     */
    static orderCubeFiles(cubeFiles: string[], cubeType: 'table' | 'seeder'): string[] {
        const executionOrder = this.loadExecutionOrder();

        if (!executionOrder) {
            return cubeFiles;
        }

        // IMPORTANTE: Los seeders SIEMPRE usan el orden de las tablas
        // porque deben insertar datos respetando las foreign keys
        const orderList = executionOrder.tables;
        const orderedFiles: string[] = [];
        const fileMap = new Map<string, string>();

        // Create a map of table names to file paths
        for (const file of cubeFiles) {
            const filePath = path.isAbsolute(file) ? file : path.join(process.cwd(), 'dbcube', file);
            const tableNameResult = FileUtils.extracTableNameFromCube(filePath);
            const tableName = tableNameResult.status === 200 ? tableNameResult.message : path.basename(file, `.${cubeType}.cube`);
            fileMap.set(tableName, file);
        }

        // Order files according to execution order (using table order)
        for (const tableName of orderList) {
            if (fileMap.has(tableName)) {
                orderedFiles.push(fileMap.get(tableName)!);
                fileMap.delete(tableName);
            }
        }

        // Add any remaining files that weren't in the order
        for (const [, file] of fileMap) {
            orderedFiles.push(file);
        }

        // Using dependency order silently

        return orderedFiles;
    }
}