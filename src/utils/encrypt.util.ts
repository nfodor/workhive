import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

/**
 * Utility class for handling encryption and decryption of sensitive data
 */
export class EncryptionUtil {
  private static readonly ALGORITHM = 'aes-256-gcm';
  private static readonly KEY_LENGTH = 32; // 256 bits
  private static readonly IV_LENGTH = 16; // 128 bits
  private static readonly TAG_LENGTH = 16; // 128 bits
  private static readonly SALT_LENGTH = 64;
  private static readonly ITERATIONS = 100000;
  private static readonly DIGEST = 'sha256';
  
  private static keyFilePath = path.join(os.homedir(), '.wifi_key');
  private static masterKey: Buffer | null = null;

  /**
   * Initialize the encryption utility by loading or generating the master key
   */
  static async init(): Promise<void> {
    try {
      this.masterKey = await fs.readFile(this.keyFilePath);
    } catch {
      // Key doesn't exist, generate a new one
      this.masterKey = crypto.randomBytes(this.KEY_LENGTH);
      await fs.writeFile(this.keyFilePath, this.masterKey, { mode: 0o600 });
    }
  }

  /**
   * Encrypt a string using the master key
   * @param text Text to encrypt
   * @returns Encrypted string in format: iv:salt:tag:ciphertext (all base64 encoded)
   */
  static async encrypt(text: string): Promise<string> {
    if (!this.masterKey) {
      await this.init();
    }

    // Generate a random salt and IV
    const salt = crypto.randomBytes(this.SALT_LENGTH);
    const iv = crypto.randomBytes(this.IV_LENGTH);
    
    // Derive a key from the master key and salt
    const key = crypto.pbkdf2Sync(
      this.masterKey!, 
      salt, 
      this.ITERATIONS, 
      this.KEY_LENGTH, 
      this.DIGEST
    );
    
    // Create cipher
    const cipher = crypto.createCipheriv(this.ALGORITHM, key, iv);
    
    // Encrypt the text
    let ciphertext = cipher.update(text, 'utf8', 'base64');
    ciphertext += cipher.final('base64');
    
    // Get the authentication tag
    const tag = cipher.getAuthTag();
    
    // Return the formatted encrypted string
    return [
      iv.toString('base64'),
      salt.toString('base64'),
      tag.toString('base64'),
      ciphertext
    ].join(':');
  }

  /**
   * Decrypt an encrypted string
   * @param encryptedText Encrypted string in format: iv:salt:tag:ciphertext
   * @returns Decrypted text
   */
  static async decrypt(encryptedText: string): Promise<string> {
    if (!this.masterKey) {
      await this.init();
    }

    // Split the encrypted text into its components
    const parts = encryptedText.split(':');
    if (parts.length !== 4) {
      throw new Error('Invalid encrypted text format');
    }
    
    const iv = Buffer.from(parts[0], 'base64');
    const salt = Buffer.from(parts[1], 'base64');
    const tag = Buffer.from(parts[2], 'base64');
    const ciphertext = parts[3];
    
    // Derive the key from the master key and salt
    const key = crypto.pbkdf2Sync(
      this.masterKey!, 
      salt, 
      this.ITERATIONS, 
      this.KEY_LENGTH, 
      this.DIGEST
    );
    
    // Create decipher
    const decipher = crypto.createDecipheriv(this.ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    
    // Decrypt the text
    let cleartext = decipher.update(ciphertext, 'base64', 'utf8');
    cleartext += decipher.final('utf8');
    
    return cleartext;
  }

  /**
   * Checks if a string is encrypted
   * @param text Text to check
   * @returns True if the text appears to be encrypted
   */
  static isEncrypted(text: string): boolean {
    const parts = text.split(':');
    if (parts.length !== 4) {
      return false;
    }
    
    try {
      // Try to decode the components to verify format
      Buffer.from(parts[0], 'base64');
      Buffer.from(parts[1], 'base64');
      Buffer.from(parts[2], 'base64');
      return true;
    } catch {
      return false;
    }
  }
}
