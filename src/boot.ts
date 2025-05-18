// boot.ts - Apply default configuration at boot time
import { NetworkControl } from './services/network-control.service';

async function applyBootConfig() {
  const networkControl = new NetworkControl();
  try {
    console.log('WorkHive: Applying boot configuration...');
    // Get the default configuration
    const defaultConfig = await networkControl.getDefaultConfig();
    if (defaultConfig) {
      console.log(`WorkHive: Activating configuration: ${defaultConfig}`);
      const result = await networkControl.activateConfig(defaultConfig);
      if (result) {
        console.log('WorkHive: Successfully activated boot configuration');
        return;
      } else {
        console.error('WorkHive: Failed to activate boot configuration');
      }
    } else {
      console.log('WorkHive: No default configuration found');
    }
    // Fallback: Try to use last WiFi network
    console.log('WorkHive: Attempting to reconnect to last WiFi network');
    await networkControl.reconnectLastWifi();
  } catch (error) {
    console.error('WorkHive boot error:', error);
  }
}

applyBootConfig();
