import { exec } from 'child_process';

/**
 * Execute a shell command
 * @param command The command to execute
 * @param throwOnError Whether to throw an error on command failure (defaults to true)
 * @returns Promise with stdout and stderr
 */
export async function executeCommand(
  command: string,
  throwOnError = true
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    exec(command, { shell: '/bin/bash' }, (error, stdout, stderr) => {
      if (error && throwOnError) {
        reject(error);
      } else {
        resolve({
          stdout: stdout.trim(),
          stderr: stderr ? stderr.trim() : ''
        });
      }
    });
  });
}
