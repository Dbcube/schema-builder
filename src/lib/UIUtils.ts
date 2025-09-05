import chalk from 'chalk';
import fs from 'fs';

export interface ProcessError {
    itemName: string;
    error: string;
    filePath?: string;
    lineNumber?: number;
}

export interface ProcessSummary {
    startTime: number;
    totalProcessed: number;
    successCount: number;
    errorCount: number;
    processedItems: string[];
    operationName: string;
    databaseName: string;
    errors: ProcessError[];
}

export class UIUtils {
    /**
     * Shows animated progress for processing items
     */
    static async showItemProgress(
        itemName: string,
        current: number,
        total: number
    ): Promise<void> {
        // Get console width, default to 80 if not available
        const consoleWidth = process.stdout.columns || 80;

        // Calculate available space for dots
        // Format: "├─ itemName " + dots + " ✓ OK"
        const prefix = `├─ ${itemName} `;
        const suffix = ` ✓ OK`;
        const availableSpace = consoleWidth - prefix.length - suffix.length;
        const maxDots = Math.max(10, availableSpace); // Minimum 10 dots

        return new Promise((resolve) => {
            process.stdout.write(`${chalk.blue('├─')} ${chalk.cyan(itemName)} `);

            let dotCount = 0;
            const interval = setInterval(() => {
                if (dotCount < maxDots) {
                    process.stdout.write(chalk.gray('.'));
                    dotCount++;
                } else {
                    clearInterval(interval);
                    resolve();
                }
            }, 10); // Faster animation
        });
    }

    /**
     * Shows success for a processed item
     */
    static showItemSuccess(itemName: string): void {
        process.stdout.write(` ${chalk.green('✓')} ${chalk.gray('OK')}\n`);
    }

    /**
     * Shows error for an item (simplified - only shows X)
     */
    static showItemError(itemName: string, error: string): void {
        process.stdout.write(` ${chalk.red('✗')}\n`);
    }

    /**
     * Shows operation header
     */
    static showOperationHeader(operationName: string, databaseName: string, icon: string = '🗑️'): void {
        console.log(`\n${chalk.cyan(icon)} ${chalk.bold.green(operationName.toUpperCase())}`);
        console.log(chalk.gray('─'.repeat(60)));
        console.log(`${chalk.blue('┌─')} ${chalk.bold(`Database: ${databaseName}`)}`);
    }

    /**
     * Shows comprehensive operation summary
     */
    static showOperationSummary(summary: ProcessSummary): void {
        const { startTime, totalProcessed, successCount, errorCount, processedItems, operationName, databaseName } = summary;
        const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);

        console.log(`\n${chalk.cyan('📊')} ${chalk.bold.green(`SUMMARY OF ${operationName.toUpperCase()}`)}`);
        console.log(chalk.gray('─'.repeat(60)));

        if (successCount > 0) {
            console.log(`${chalk.green('┌─')} ${chalk.bold('Successful processing:')}`);
            console.log(`${chalk.green('├─')} ${chalk.cyan(`Items processed: ${successCount}`)}`);
            console.log(`${chalk.green('├─')} ${chalk.gray(`Database: ${databaseName}`)}`);

            if (processedItems.length > 0) {
                console.log(`${chalk.green('├─')} ${chalk.yellow('Items updated:')}`);
                processedItems.forEach((item, index) => {
                    const isLast = index === processedItems.length - 1;
                    const connector = isLast ? '└─' : '├─';
                    console.log(`${chalk.green('│  ')} ${chalk.gray(connector)} ${chalk.cyan(item)}`);
                });
            }
        }

        if (errorCount > 0) {
            console.log(`${chalk.red('├─')} ${chalk.bold.red(`Errors: ${errorCount}`)}`);
        }

        console.log(`${chalk.blue('├─')} ${chalk.gray(`Total time: ${totalTime}s`)}`);
        console.log(`${chalk.blue('└─')} ${chalk.bold(totalProcessed > 0 ? chalk.green('✅ Completed') : chalk.yellow('⚠️  No changes'))}`);

        // Show detailed errors section if there are errors
        if (summary.errors && summary.errors.length > 0) {
            console.log(`\n${chalk.red('🚫')} ${chalk.bold.red('ERRORS FOUND')}`);
            console.log(chalk.red('─'.repeat(60)));
            
            summary.errors.forEach((error, index) => {
                // Show error with [error] tag format
                console.log(`${chalk.red('[error]')} ${chalk.red(error.error)}`);
                console.log('');
                
                if (error.filePath) {
                    // Show code location with [code] tag format
                    const location = error.lineNumber ? `${error.filePath}:${error.lineNumber}:7` : error.filePath;
                    console.log(`${chalk.cyan('[code]')} ${chalk.yellow(location)}`);
                    
                    // Try to show code context if file exists
                    UIUtils.showCodeContext(error.filePath, error.lineNumber || 1);
                }
                
                if (index < summary.errors.length - 1) {
                    console.log('');
                }
            });
        }
    }

    /**
     * Shows code context around an error location
     */
    static showCodeContext(filePath: string, lineNumber: number, contextLines: number = 2): void {
        try {
            const content = fs.readFileSync(filePath, 'utf8');
            const lines = content.split('\n');
            
            const startLine = Math.max(0, lineNumber - contextLines - 1);
            const endLine = Math.min(lines.length, lineNumber + contextLines);
            
            for (let i = startLine; i < endLine; i++) {
                const currentLineNum = i + 1;
                const line = lines[i];
                const lineNumStr = currentLineNum.toString().padStart(4, ' ');
                
                if (currentLineNum === lineNumber) {
                    // Highlight the error line with arrow
                    console.log(`${chalk.gray(lineNumStr)} ${chalk.red('<-')}       ${chalk.white(line)}`);
                } else {
                    // Normal context lines
                    console.log(`${chalk.gray(lineNumStr)}          ${chalk.white(line)}`);
                }
            }
        } catch (error) {
            // If we can't read the file, just skip showing context
            console.log(chalk.gray('   (unable to show code context)'));
        }
    }
}