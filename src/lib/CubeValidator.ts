import fs from 'fs';
import path from 'path';
import { ProcessError } from './UIUtils';

export interface ValidationResult {
    isValid: boolean;
    errors: ProcessError[];
}

export class CubeValidator {
    private validTypes = ['varchar', 'int', 'string', 'text', 'boolean', 'date', 'datetime', 'timestamp', 'decimal', 'float', 'double', 'enum', 'json'];
    private validOptions = ['not null', 'primary', 'autoincrement', 'unique', 'zerofill', 'index', 'required', 'unsigned'];
    private validProperties = ['type', 'length', 'options', 'value', 'defaultValue', 'foreign', 'enumValues', 'description'];
    private knownAnnotations = ['database', 'table', 'meta', 'columns', 'fields', 'dataset', 'beforeAdd', 'afterAdd', 'beforeUpdate', 'afterUpdate', 'beforeDelete', 'afterDelete', 'compute', 'column'];

    /**
     * Validates a cube file comprehensively
     */
    validateCubeFile(filePath: string): ValidationResult {
        const errors: ProcessError[] = [];
        
        try {
            const content = fs.readFileSync(filePath, 'utf8');
            const lines = content.split('\n');
            const fileName = path.basename(filePath, path.extname(filePath));

            // Validate each line
            for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
                const line = lines[lineIndex];
                
                // Skip empty lines and comments
                if (line.trim() === '' || line.trim().startsWith('//')) {
                    continue;
                }

                // Validate annotations
                this.validateAnnotations(line, lineIndex + 1, filePath, fileName, errors);
                
                // Validate data types
                this.validateDataTypes(line, lineIndex + 1, filePath, fileName, errors, content);
                
                // Validate column options
                this.validateColumnOptions(line, lineIndex + 1, filePath, fileName, errors, lines);
                
                // Validate column properties
                this.validateColumnProperties(line, lineIndex + 1, filePath, fileName, errors, content);
                
                // Validate required column properties
                this.validateRequiredColumnProperties(lines, lineIndex + 1, filePath, fileName, errors);
                
                // Validate general syntax
                this.validateGeneralSyntax(line, lineIndex + 1, filePath, fileName, errors);
            }

            // Validate overall structure
            this.validateOverallStructure(content, filePath, fileName, errors);

        } catch (error: any) {
            errors.push({
                itemName: path.basename(filePath, path.extname(filePath)),
                error: `Failed to read cube file: ${error.message}`,
                filePath,
                lineNumber: 1
            });
        }

        return {
            isValid: errors.length === 0,
            errors
        };
    }

    private validateAnnotations(line: string, lineNumber: number, filePath: string, fileName: string, errors: ProcessError[]): void {
        const annotationRegex = /@(\w+)/g;
        let match;
        
        while ((match = annotationRegex.exec(line)) !== null) {
            const annotation = match[1];
            
            if (!this.knownAnnotations.includes(annotation)) {
                errors.push({
                    itemName: fileName,
                    error: `Unknown annotation '@${annotation}'. Valid annotations: ${this.knownAnnotations.join(', ')}`,
                    filePath,
                    lineNumber
                });
            }
        }
    }

    private validateDataTypes(line: string, lineNumber: number, filePath: string, fileName: string, errors: ProcessError[], content: string): void {
        const typeRegex = /type:\s*["'](\w+)["']/g;
        let match;
        
        while ((match = typeRegex.exec(line)) !== null) {
            const type = match[1];
            
            if (!this.validTypes.includes(type)) {
                errors.push({
                    itemName: fileName,
                    error: `Invalid data type '${type}'. Valid types: ${this.validTypes.join(', ')}`,
                    filePath,
                    lineNumber
                });
            }
        }

        // Check for varchar without length
        if (line.includes('type: "varchar"')) {
            const lines = content.split('\n');
            const hasLengthNearby = lines.slice(Math.max(0, lineNumber - 1), Math.min(lineNumber + 4, lines.length))
                .some(nextLine => nextLine.includes('length:'));
            
            if (!hasLengthNearby) {
                errors.push({
                    itemName: fileName,
                    error: 'VARCHAR type requires a length specification',
                    filePath,
                    lineNumber
                });
            }
        }
    }

    private validateColumnOptions(line: string, lineNumber: number, filePath: string, fileName: string, errors: ProcessError[], lines: string[]): void {
        const optionsMatch = line.match(/^\s*options\s*:\s*\[(.*)\]\s*;?\s*$/);
        if (!optionsMatch) return;

        const optionsContent = optionsMatch[1].trim();
        
        // Check for invalid syntax (values without quotes)
        const invalidSyntaxMatch = optionsContent.match(/[^",\s]+(?![^"]*")/);
        if (invalidSyntaxMatch) {
            errors.push({
                itemName: fileName,
                error: `Invalid syntax '${invalidSyntaxMatch[0]}' in options array. All values must be quoted strings`,
                filePath,
                lineNumber
            });
            return;
        }

        // Extract individual options
        const optionMatches = optionsContent.match(/"([^"]*)"/g);
        if (optionMatches) {
            // Get column type for compatibility checking
            const columnType = this.getColumnTypeForOptions(lines, lineNumber - 1);
            
            optionMatches.forEach(optionMatch => {
                const option = optionMatch.replace(/"/g, '');
                
                if (option.trim() === '') {
                    errors.push({
                        itemName: fileName,
                        error: 'Empty option found in options array. All options must have a value',
                        filePath,
                        lineNumber
                    });
                } else if (!this.validOptions.includes(option)) {
                    errors.push({
                        itemName: fileName,
                        error: `Invalid option '${option}'. Valid options: ${this.validOptions.join(', ')}`,
                        filePath,
                        lineNumber
                    });
                } else if (columnType !== 'unknown' && !this.isOptionCompatibleWithType(option, columnType)) {
                    errors.push({
                        itemName: fileName,
                        error: `Option '${option}' is not compatible with type '${columnType}'`,
                        filePath,
                        lineNumber
                    });
                }
            });
        }
    }

    private validateColumnProperties(line: string, lineNumber: number, filePath: string, fileName: string, errors: ProcessError[], content: string): void {
        const propertyKeyRegex = /^\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*:/;
        const propMatch = propertyKeyRegex.exec(line);
        
        if (!propMatch) return;

        const propertyName = propMatch[1];
        
        // Skip column definitions (they end with opening brace)
        if (/^\s*[a-zA-Z_][a-zA-Z0-9_]*\s*:\s*\{/.test(line)) {
            return;
        }

        // Check if we're inside a foreign key object
        if (this.isInsideForeignKeyObject(content, lineNumber - 1)) {
            // Inside foreign key object, validate foreign key properties
            const validForeignKeyProperties = ['table', 'column'];
            if (!validForeignKeyProperties.includes(propertyName)) {
                errors.push({
                    itemName: fileName,
                    error: `Invalid foreign key property '${propertyName}'. Valid foreign key properties: ${validForeignKeyProperties.join(', ')}`,
                    filePath,
                    lineNumber
                });
            }
            return; // Skip other validation for foreign key properties
        }

        // Check if we're inside a columns block and validate property
        if (this.isInsideColumnsBlock(content, lineNumber - 1)) {
            if (!this.validProperties.includes(propertyName)) {
                errors.push({
                    itemName: fileName,
                    error: `Invalid property '${propertyName}'. Valid properties: ${this.validProperties.join(', ')}`,
                    filePath,
                    lineNumber
                });
            }
        }

        // Check for incomplete property declarations
        if (/^\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*$/.test(line)) {
            errors.push({
                itemName: fileName,
                error: `Property '${propertyName}' is missing a value`,
                filePath,
                lineNumber
            });
        }
    }

    private validateRequiredColumnProperties(lines: string[], lineNumber: number, filePath: string, fileName: string, errors: ProcessError[]): void {
        const line = lines[lineNumber - 1];
        
        // Check if current line is the closing of a column definition
        if (!/^\s*\}\s*;?\s*$/.test(line)) {
            return;
        }

        // Find the start of this column definition
        let columnStartLine = -1;
        let columnName = '';
        
        for (let i = lineNumber - 2; i >= 0; i--) {
            const currentLine = lines[i];
            const columnDefMatch = currentLine.match(/^\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*\{/);
            
            if (columnDefMatch) {
                // Verify this is the matching opening brace
                let openBraces = 0;
                let closeBraces = 0;
                
                for (let j = i; j < lineNumber; j++) {
                    openBraces += (lines[j].match(/\{/g) || []).length;
                    closeBraces += (lines[j].match(/\}/g) || []).length;
                }
                
                if (openBraces === closeBraces) {
                    columnStartLine = i;
                    columnName = columnDefMatch[1];
                    break;
                }
            }
        }

        if (columnStartLine === -1 || !columnName) return;

        // Check for missing 'type' property
        let hasType = false;
        
        for (let i = columnStartLine + 1; i < lineNumber - 1; i++) {
            if (lines[i].match(/^\s*type\s*:/)) {
                hasType = true;
                break;
            }
        }
        
        if (!hasType && columnName !== 'foreign' && columnName !== 'defaultValue') {
            errors.push({
                itemName: fileName,
                error: `Column '${columnName}' is missing required 'type' property`,
                filePath,
                lineNumber: columnStartLine + 1
            });
        }
    }

    private validateGeneralSyntax(line: string, lineNumber: number, filePath: string, fileName: string, errors: ProcessError[]): void {
        // Check for mismatched quotes
        const quotes = line.match(/["']/g);
        if (quotes && quotes.length % 2 !== 0) {
            errors.push({
                itemName: fileName,
                error: 'Mismatched quotes detected',
                filePath,
                lineNumber
            });
        }

        // Check for invalid annotation syntax
        if (line.includes('@database') || line.includes('@table')) {
            const stringAnnotationRegex = /@(database|table)\s*\(\s*"([^"]*)"\s*\)/;
            if (!stringAnnotationRegex.test(line)) {
                errors.push({
                    itemName: fileName,
                    error: 'Invalid annotation syntax. Expected format: @annotation("value")',
                    filePath,
                    lineNumber
                });
            }
        }

        // Check for @meta annotation syntax
        if (line.includes('@meta')) {
            const metaObjectRegex = /@meta\s*\(\s*\{/;
            if (!metaObjectRegex.test(line)) {
                errors.push({
                    itemName: fileName,
                    error: 'Invalid @meta syntax. Expected format: @meta({ ... })',
                    filePath,
                    lineNumber
                });
            }
        }
    }

    private validateOverallStructure(content: string, filePath: string, fileName: string, errors: ProcessError[]): void {
        const lines = content.split('\n');
        
        // Check for required @database annotation
        const hasDatabase = lines.some(line => line.includes('@database'));
        if (!hasDatabase) {
            errors.push({
                itemName: fileName,
                error: 'Missing required @database annotation',
                filePath,
                lineNumber: 1
            });
        }

        // For table.cube files, check for @columns
        if (filePath.includes('.table.cube')) {
            const hasColumns = lines.some(line => line.includes('@columns'));
            if (!hasColumns) {
                errors.push({
                    itemName: fileName,
                    error: 'Table cube files require @columns annotation',
                    filePath,
                    lineNumber: 1
                });
            }
        }
    }

    private getColumnTypeForOptions(lines: string[], optionsLineIndex: number): string {
        // Look backwards from options line to find the type
        for (let i = optionsLineIndex - 1; i >= 0; i--) {
            const line = lines[i];
            const typeMatch = line.match(/^\s*type\s*:\s*"([^"]+)"/);
            if (typeMatch) {
                return typeMatch[1];
            }
            // Stop if we hit another column definition
            if (/^\s*[a-zA-Z_][a-zA-Z0-9_]*\s*:\s*\{/.test(line)) {
                break;
            }
        }
        return 'unknown';
    }

    private isOptionCompatibleWithType(option: string, type: string): boolean {
        const compatibilityRules: { [key: string]: string[] } = {
            "zerofill": ["int", "decimal", "float", "double"],
            "unsigned": ["int", "decimal", "float", "double"],
            "autoincrement": ["int"],
            "primary": ["int", "varchar", "string"],
            "not null": ["int", "varchar", "string", "text", "boolean", "date", "datetime", "timestamp", "decimal", "float", "double"],
            "unique": ["int", "varchar", "string", "text"],
            "index": ["int", "varchar", "string", "text", "date", "datetime", "timestamp"],
            "required": ["int", "varchar", "string", "text", "boolean", "date", "datetime", "timestamp", "decimal", "float", "double"]
        };
        
        const compatibleTypes = compatibilityRules[option];
        if (!compatibleTypes) {
            return true; // If not in rules, allow it
        }
        
        return compatibleTypes.includes(type);
    }

    private isInsideColumnsBlock(content: string, lineIndex: number): boolean {
        const lines = content.split('\n');
        
        // Find @columns block boundaries
        let columnsStartLine = -1;
        let columnsEndLine = -1;
        
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].includes('@columns')) {
                columnsStartLine = i;
                // Find the end of the @columns block
                let braceCount = 0;
                for (let j = i; j < lines.length; j++) {
                    const currentLine = lines[j];
                    braceCount += (currentLine.match(/\{/g) || []).length;
                    braceCount -= (currentLine.match(/\}/g) || []).length;
                    if (braceCount === 0 && j > i) {
                        columnsEndLine = j;
                        break;
                    }
                }
                break;
            }
        }
        
        return columnsStartLine !== -1 && columnsEndLine !== -1 && 
               lineIndex > columnsStartLine && lineIndex < columnsEndLine;
    }

    private isInsideForeignKeyObject(content: string, lineIndex: number): boolean {
        const lines = content.split('\n');
        
        // Look backwards from current line to find if we're inside a foreign object
        for (let i = lineIndex; i >= 0; i--) {
            const line = lines[i];
            
            // If we find a foreign: { on this line or above
            if (/foreign\s*:\s*\{/.test(line)) {
                // Count braces from the foreign line to current line to see if we're inside
                let braceCount = 0;
                
                // Start from the foreign line
                for (let j = i; j <= lineIndex; j++) {
                    const currentLine = lines[j];
                    
                    // Count opening braces
                    const openBraces = (currentLine.match(/\{/g) || []).length;
                    // Count closing braces
                    const closeBraces = (currentLine.match(/\}/g) || []).length;
                    
                    braceCount += openBraces - closeBraces;
                    
                    // If we've closed all braces, we're outside the foreign object
                    if (braceCount === 0 && j > i) {
                        return false;
                    }
                }
                
                // If we still have open braces, we're inside the foreign object
                return braceCount > 0;
            }
            
            // If we find a closing brace before finding a foreign declaration,
            // we're not inside a foreign object
            if (line.trim() === '}' || line.includes('};')) {
                break;
            }
        }
        
        return false;
    }
}