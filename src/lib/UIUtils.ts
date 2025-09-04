import chalk from 'chalk';

export interface ProcessSummary {
    startTime: number;
    totalProcessed: number;
    successCount: number;
    errorCount: number;
    processedItems: string[];
    operationName: string;
    databaseName: string;
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
     * Shows error for an item
     */
    static showItemError(itemName: string, error: string): void {
        process.stdout.write(` ${chalk.red('✗')} ${chalk.red('ERROR')}\n`);
        console.log(`${chalk.red('│  ')} ${chalk.gray('└─')} ${chalk.red(error)}`);
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

        if (totalProcessed > 0) {
            console.log(`\n${chalk.green('🎉')} ${chalk.bold(`${operationName} executed successfully!`)}`);
        } else {
            console.log(`\n${chalk.yellow('⚠️ ')} ${chalk.bold('No items were processed.')}`);
        }
    }
}