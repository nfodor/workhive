import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export async function executeCommand(command: string, throwOnError = true): Promise<{ stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execAsync(command);
    return { stdout, stderr };
  } catch (error: any) {
    if (throwOnError) {
      throw new Error(`Command execution failed: ${error.message}`);
    }
    return { stdout: '', stderr: error.message };
  }
}
