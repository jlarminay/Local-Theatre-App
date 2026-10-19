import {
  BarcodeFormat,
  BarcodeScanner,
  GoogleBarcodeScannerModuleInstallState,
} from '@capacitor-mlkit/barcode-scanning';
import { Capacitor } from '@capacitor/core';

// Reading a QR code with Google's code scanner (Play services' own scanning
// screen), e.g. to bring a TMDB key over from a computer. It needs no camera
// permission: Play services does the scanning. Phone only.

export const canScanQr = Capacitor.isNativePlatform();

/** Downloads Play services' scanner module if it isn't on the phone yet (sideloaded apps don't get it at install). */
async function ensureScannerModule(onStatus: (message: string) => void) {
  const { available } = await BarcodeScanner.isGoogleBarcodeScannerModuleAvailable();
  if (available) return;
  onStatus('Downloading the QR scanner…');
  await new Promise<void>((resolve, reject) => {
    const done = BarcodeScanner.addListener(
      'googleBarcodeScannerModuleInstallProgress',
      (event) => {
        if (event.state === GoogleBarcodeScannerModuleInstallState.COMPLETED) finish();
        else if (
          event.state === GoogleBarcodeScannerModuleInstallState.FAILED ||
          event.state === GoogleBarcodeScannerModuleInstallState.CANCELED
        )
          finish(
            new Error("Couldn't download the QR scanner. Check your connection and try again."),
          );
      },
    );
    function finish(err?: Error) {
      done.then((listener) => listener.remove());
      if (err) reject(err);
      else resolve();
    }
    BarcodeScanner.installGoogleBarcodeScannerModule().catch((err) => finish(err));
  });
}

/** Scans one QR code; resolves with its text, or null if the user backed out. */
export async function scanQr(
  onStatus: (message: string) => void = () => {},
): Promise<string | null> {
  await ensureScannerModule(onStatus);
  onStatus('');
  try {
    const { barcodes } = await BarcodeScanner.scan({ formats: [BarcodeFormat.QrCode] });
    return barcodes[0]?.rawValue?.trim() || null;
  } catch (err) {
    if (/cancel/i.test(String((err as Error)?.message ?? err))) return null;
    throw err;
  }
}
