// Test QR code generation
import { generateNetworkQR } from './src/utils/display.util';

async function testQRCode() {
  console.log('Generating QR code for test network...');
  await generateNetworkQR('TestNetwork', 'TestPassword123');
  console.log('QR code generation complete');
}

testQRCode()
  .then(() => console.log('Test completed'))
  .catch(err => console.error('Test failed:', err));
