import { executeCommand } from '../utils/command.util';
import { WireGuardConfig, WireGuardStatus } from '../interfaces/wireguard.interface';

export class WireGuardService {
  async generateKeys(): Promise<{ privateKey: string; publicKey: string }> {
    const { stdout: privateKey } = await executeCommand('wg genkey');
    const { stdout: publicKey } = await executeCommand(`echo "${privateKey.trim()}" | wg pubkey`);
    return {
      privateKey: privateKey.trim(),
      publicKey: publicKey.trim()
    };
  }

  private async getPublicKey(privateKey: string): Promise<string> {
    const { stdout } = await executeCommand(`echo "${privateKey}" | wg pubkey`);
    return stdout.trim();
  }

  private async getFreeIP(baseIP: string, subnet: number): Promise<string> {
    const parts = baseIP.split('.');
    const base = parts.slice(0, 3).join('.');
    const start = parseInt(parts[3]);

    for (let i = start; i < 255; i++) {
      const ip = `${base}.${i}/${subnet}`;
      try {
        const { stdout } = await executeCommand(`ping -c 1 -W 1 ${base}.${i}`);
        if (!stdout.includes('1 received')) {
          return ip;
        }
      } catch {
        return ip;
      }
    }
    throw new Error('No free IPs available');
  }

  async setup(options: {
    endpoint: string;
    allowedIPs: string[];
    dns?: string;
    listenPort?: number;
    privateKey?: string;
  }): Promise<{ success: boolean; config?: WireGuardConfig }> {
    try {
      // Generate keys if not provided
      const keys = options.privateKey ? 
        { privateKey: options.privateKey, publicKey: await this.getPublicKey(options.privateKey) } :
        await this.generateKeys();

      // Get a free IP from the allowed range
      const baseIP = options.allowedIPs[0].split('/')[0];
      const subnet = parseInt(options.allowedIPs[0].split('/')[1]) || 24;
      const ip = await this.getFreeIP(baseIP, subnet);

      const config: WireGuardConfig = {
        privateKey: keys.privateKey,
        publicKey: keys.publicKey,
        address: ip,
        endpoint: options.endpoint,
        allowedIPs: options.allowedIPs,
        dns: options.dns,
        persistentKeepalive: 25
      };

      const confContent = `[Interface]
PrivateKey = ${keys.privateKey}
Address = ${ip}
${options.dns ? `DNS = ${options.dns}` : ''}
ListenPort = ${options.listenPort || 51820}

[Peer]
PublicKey = ${keys.publicKey}
AllowedIPs = ${options.allowedIPs.join(', ')}
Endpoint = ${options.endpoint}
PersistentKeepalive = 25`;

      await executeCommand(`echo "${confContent}" | sudo tee /etc/wireguard/wg0.conf > /dev/null`);
      await executeCommand('sudo chmod 600 /etc/wireguard/wg0.conf');
      await executeCommand('sudo systemctl enable wg-quick@wg0');
      await executeCommand('sudo systemctl start wg-quick@wg0');

      return {
        success: true,
        config
      };
    } catch (error) {
      console.error('Failed to setup WireGuard:', error);
      return { success: false };
    }
  }

  async getStatus(): Promise<WireGuardStatus> {
    try {
      const { stdout } = await executeCommand('sudo wg show wg0');
      if (!stdout) {
        return { active: false };
      }

      const lines = stdout.split('\n');
      const status: WireGuardStatus = { active: true };

      lines.forEach(line => {
        const [key, value] = line.split(':').map(s => s.trim());
        switch(key) {
          case 'public key':
            status.publicKey = value;
            break;
          case 'endpoint':
            status.endpoint = value;
            break;
          case 'transfer':
            const [rx, tx] = value.split('received,').map(s => s.trim());
            status.transferRx = rx.replace('received', '').trim();
            status.transferTx = tx.replace('sent', '').trim();
            break;
          case 'latest handshake':
            status.lastHandshake = value;
            break;
        }
      });

      return status;
    } catch {
      return { active: false };
    }
  }

  async stop(): Promise<boolean> {
    try {
      // More robust approach to stopping WireGuard
      // First check if the service is active
      const { stdout: status } = await executeCommand('systemctl is-active wg-quick@wg0', false);
      
      if (status.trim() === 'active') {
        await executeCommand('sudo systemctl stop wg-quick@wg0');
        await executeCommand('sudo systemctl disable wg-quick@wg0');
      } else {
        // If service is not active, try to bring down the interface directly
        try {
          await executeCommand('sudo ip link del dev wg0', false);
        } catch {
          // Interface might not exist, which is fine
        }
      }
      
      // Verify that the interface is gone
      try {
        const { stdout: ifaceCheck } = await executeCommand('ip a show wg0', false);
        if (ifaceCheck.trim()) {
          // If interface still exists, try to force it down
          await executeCommand('sudo ip link set wg0 down');
          await executeCommand('sudo ip link del dev wg0');
        }
      } catch {
        // Interface doesn't exist, which is what we want
      }
      
      return true;
    } catch (error) {
      console.error('Failed to stop WireGuard:', error);
      return false;
    }
  }
}
