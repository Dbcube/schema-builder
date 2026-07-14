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

/**
 * Reporter que recibe los eventos de una operación de schema.
 * Todos los métodos son opcionales: quien renderiza decide qué le interesa.
 */
export interface SchemaReporter {
    operationStart?(op: { operation: string; database: string }): void;
    itemStart?(item: { name: string; index: number; total: number }): void;
    itemSuccess?(item: { name: string }): void;
    itemError?(item: { name: string; error: string }): void;
    operationEnd?(summary: ProcessSummary): void;
    /** Error fatal fuera del ciclo de items (p. ej. fallo al crear la base). */
    fatal?(err: { message: string; filePath?: string; lineNumber?: number }): void;
    /** Salida cruda opcional (dry-run: sentencias SQL). */
    raw?(line: string): void;
}

/**
 * UIUtils ya NO imprime: es un bus de eventos.
 *
 * Una librería no debe escribir en la consola del programa que la usa, y tener
 * dos renderers (este + el del CLI) era la causa de las salidas duplicadas y
 * las letras sobrepuestas. Ahora el CLI instala su renderer con
 * `UIUtils.setReporter(...)` y es el ÚNICO que dibuja. Sin reporter, silencio.
 *
 * Además, `showItemProgress` ya no anima puntos con un setInterval que se
 * esperaba ANTES de hacer el trabajo real (por eso "la UI cargaba y luego
 * recién se ejecutaba"): ahora sólo notifica el inicio del item y retorna.
 */
export class UIUtils {
    private static reporter: SchemaReporter | null = null;

    /** Instala el renderer (el CLI). Pasar null vuelve al modo silencioso. */
    static setReporter(reporter: SchemaReporter | null): void {
        UIUtils.reporter = reporter;
    }

    static getReporter(): SchemaReporter | null {
        return UIUtils.reporter;
    }

    /** Notifica que empieza a procesarse un item. No bloquea ni anima. */
    static async showItemProgress(itemName: string, current: number, total: number): Promise<void> {
        UIUtils.reporter?.itemStart?.({ name: itemName, index: current, total });
    }

    static showItemSuccess(itemName: string): void {
        UIUtils.reporter?.itemSuccess?.({ name: itemName });
    }

    static showItemError(itemName: string, error: string): void {
        UIUtils.reporter?.itemError?.({ name: itemName, error });
    }

    /** `icon` se mantiene por compatibilidad de firma; ya no se usa. */
    static showOperationHeader(operationName: string, databaseName: string, _icon?: string): void {
        UIUtils.reporter?.operationStart?.({
            operation: operationName.trim(),
            database: databaseName,
        });
    }

    static showOperationSummary(summary: ProcessSummary): void {
        UIUtils.reporter?.operationEnd?.(summary);
    }

    /** Error fatal (fuera del ciclo de items). */
    static showFatal(message: string, filePath?: string, lineNumber?: number): void {
        UIUtils.reporter?.fatal?.({ message, filePath, lineNumber });
    }

    /** Línea cruda (dry-run). */
    static showRaw(line: string): void {
        UIUtils.reporter?.raw?.(line);
    }

    /**
     * Lee el contexto de código alrededor de una línea. Devuelve las líneas en
     * vez de imprimirlas: quien renderiza decide cómo mostrarlas.
     */
    static readCodeContext(
        filePath: string,
        lineNumber: number,
        contextLines: number = 2
    ): Array<{ line: number; text: string; isError: boolean }> {
        try {
            const lines = fs.readFileSync(filePath, 'utf8').split('\n');
            const start = Math.max(0, lineNumber - contextLines - 1);
            const end = Math.min(lines.length, lineNumber + contextLines);

            const out: Array<{ line: number; text: string; isError: boolean }> = [];
            for (let i = start; i < end; i++) {
                out.push({ line: i + 1, text: lines[i], isError: i + 1 === lineNumber });
            }
            return out;
        } catch {
            return [];
        }
    }
}
