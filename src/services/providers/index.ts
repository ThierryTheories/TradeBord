/**
 * Provider wiring. Registering a new venue is a one-line change here.
 */
import { registerProvider } from '../marketData';
import { BinanceProvider } from './binance';

registerProvider(new BinanceProvider());

// Future venues slot in the same way, no UI changes required:
// registerProvider(new BybitProvider());
// registerProvider(new BitgetProvider());

export { BinanceProvider };
