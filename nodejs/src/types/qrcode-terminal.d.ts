declare module 'qrcode-terminal' {
  interface QRCodeOptions {
    small?: boolean;
  }

  interface QRCode {
    generate(text: string, callback?: (qrcode: string) => void): void;
    generate(text: string, options: QRCodeOptions, callback?: (qrcode: string) => void): void;
    setErrorLevel(error: 'L' | 'M' | 'Q' | 'H'): void;
  }

  const qrcode: QRCode;
  export = qrcode;
}
