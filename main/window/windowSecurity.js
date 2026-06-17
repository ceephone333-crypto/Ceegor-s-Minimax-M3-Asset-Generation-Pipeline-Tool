// main/window/windowSecurity.js
// Setzt Electron-Switches für DPI + Native-Win-Occlusion.
// Wird beim App-Start VOR `app.whenReady` per Side-Effect ausgeführt.
//
// Grund für diese Exporte: ohne `disable-features=CalculateNativeWinOcclusion`
// wendet der Windows-Compositor auf teilweise verdeckte Fenster Unschärfe an
// (sichtbar als matschiger Text beim Verschieben). Der Scale-Switch stellt
// sicher, dass die Renderer-UI nie durch fraktionale DPI-Werte unscharf wird.
//
// Beide Switches sind absichtlich **global** — sie wirken app-weit und
// werden vom Renderer nicht überschrieben.

const { app } = require('electron');

app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
app.commandLine.appendSwitch('force-device-scale-factor', '1');
