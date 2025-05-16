// Direct test using the qrcode-terminal library
const qrcode = require('qrcode-terminal');

console.log('Starting direct QR code test...');
console.log('-----------------------------');

// Using qrcode-terminal directly - this should work
const wifiString = `WIFI:S:TestNetwork;T:WPA;P:TestPassword123;;`;
qrcode.generate(wifiString, { small: true });

console.log('-----------------------------');
console.log('QR code test complete');
