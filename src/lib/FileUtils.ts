import * as fs from 'fs';
import * as path from 'path';

class FileUtils {
  /**
   * Verifica si un archivo existe (asincrónico).
   * @param filePath - Ruta del archivo.
   * @returns True si el archivo existe, false si no.
   */
  static async fileExists(filePath: string): Promise<boolean> {
    return new Promise((resolve) => {
      fs.access(path.resolve(filePath), fs.constants.F_OK, (err) => {
        resolve(!err);
      });
    });
  }

  /**
   * Verifica si un archivo existe (sincrónico).
   * @param filePath - Ruta del archivo.
   * @returns True si el archivo existe, false si no.
   */
  static fileExistsSync(filePath: string): boolean {
    try {
      fs.accessSync(path.resolve(filePath), fs.constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }

  static extractDatabaseName(input: string): string | null {
    const match = input.match(/@database\(["']?([\w-]+)["']?\)/);
    return match ? match[1] : null;
  }

  /**
   * Lee recursivamente archivos que terminan en un sufijo dado y los ordena numéricamente.
   * @param dir - Directorio base (relativo o absoluto).
   * @param suffix - Sufijo de archivo (como 'table.cube').
   * @returns Rutas absolutas de los archivos encontrados y ordenados.
   */
  static getCubeFilesRecursively(dir: string, suffix: string): string[] {
    const baseDir = path.resolve(dir); // ✅ Asegura que sea absoluto
    const cubeFiles: string[] = [];

    function recurse(currentDir: string): void {
      const entries = fs.readdirSync(currentDir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name);

        if (entry.isDirectory()) {
          recurse(fullPath);
        } else if (entry.isFile() && entry.name.endsWith(suffix)) {
          cubeFiles.push(fullPath); // Ya es absoluta
        }
      }
    }

    recurse(baseDir);

    // Ordenar por número si los archivos comienzan con un número
    cubeFiles.sort((a, b) => {
      const aNum = parseInt(path.basename(a));
      const bNum = parseInt(path.basename(b));
      return (isNaN(aNum) ? 0 : aNum) - (isNaN(bNum) ? 0 : bNum);
    });

    return cubeFiles;
  }

  /**
   * Extracts database name from cube files
   * @param filePath - Path to the .cube file
   * @returns Object containing status and database name
   */
  static extractDatabaseNameFromCube(filePath: string) {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      
      // Pattern: @database("database_name") or @database('database_name')
      const databaseMatch = content.match(/@database\s*\(\s*["']([^"']+)["']\s*\)\s*;?/);
      if (databaseMatch) {
        return {
          status: 200,
          message: databaseMatch[1]
        };
      }
      
      throw new Error(`No @database directive found in file ${filePath}`);
      
    } catch (error: unknown) {
      if (error instanceof Error) {
        return {
          status: 500,
          message: error.message
        };
      }
      return {
        status: 500,
        message: String(error)
      };
    }
  }

  /**
   * Extrae nombres de tablas reales de archivos .cube
   * @param {string} filePath - String ruta del archivo .cube
   * @returns {object} - Objeto que contiene el estado y el mensaje con el nombre de la tabla
  */
  static extracTableNameFromCube(filePath: string) {
    try {
      const content = fs.readFileSync(filePath, 'utf8');

      // Patrón principal: @meta({ name: "nombre_tabla"; }) o @meta({ name: 'nombre_tabla'; })
      const metaMatch = content.match(/@meta\s*\(\s*\{\s*name\s*:\s*["']([^"']+)["']\s*;\s*[^}]*\}\s*\)/s);
      if (metaMatch) {
        return {
          status: 200,
          message: metaMatch[1]
        };
      }

      throw new Error(`Error to execute this file ${filePath} because no exist a name of table.`);

    } catch (error: unknown) {
      if (error instanceof Error) {
        return {
          status: 500,
          message: error.message
        };
      }
      return {
        status: 500,
        message: String(error)
      };
    }
  }
}

export default FileUtils;