import blessed from 'blessed';
import { NetworkControl } from './services/network-control.service';
import { WireGuardStatus } from './interfaces/wireguard.interface';
import { getPublicIp } from './utils/display.util';
import { executeCommand } from './utils/command.util';
import { WiFiNetwork } from './interfaces/wifi.interface';

// Helper function for smart truncation
function smartTruncateTagAware(text: string, maxLength: number): string {
    if (maxLength <= 0) return '';
    // Use blessed.stripTags to get the visible length for comparison
    if (blessed.stripTags(text).length <= maxLength) {
        return text;
    }

    let truncatedText = '';
    let currentVisibleLength = 0;

    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        if (char === '{' && text.indexOf('}', i) !== -1) {
            const tagCloseIndex = text.indexOf('}', i);
            const tag = text.substring(i, tagCloseIndex + 1);
            truncatedText += tag;
            i = tagCloseIndex;
        } else {
            // For non-tag characters, assume each character has a width of 1 after tags are stripped.
            // This is a simplification and might not be 100% accurate for all Unicode characters,
            // but it's a common approach with blessed when detailed unicode width is problematic.
            if (currentVisibleLength < maxLength) {
                truncatedText += char;
                currentVisibleLength++;
            } else {
                break; // Max length reached
            }
        }
    }
    return truncatedText;
}

// Existing StatusData interface (used by showDynamicMultiPageStatusScreen and status header)
interface StatusData {
    connected: boolean;
    ssid?: string;
    mode: string; // 'wifi', 'ap', 'ethernet', 'disconnected', 'unknown'
    signal?: number;
    freq?: string;
    bitrate?: string;
    security?: string[];
    ipAddress?: string;
    gateway?: string;
    macAddress?: string;
    interfaceName?: string;
    publicIp?: string;
    vpnDetails?: WireGuardStatus;
    pingGatewayOk?: boolean;
    pingInternetOk?: boolean;
}

// --- Main Application TUI ---

let screen: blessed.Widgets.Screen | null = null;
let networkControl: NetworkControl | null = null;
let statusHeaderBox: blessed.Widgets.BoxElement | null = null;
let mainMenuList: blessed.Widgets.ListElement | null = null;
let interactionPane: blessed.Widgets.BoxElement | null = null;
let logBox: blessed.Widgets.Log | null = null;

const mainMenuTitle = 'WorkHive Control Panel';

const mainMenuItems = [
    'Scan for Networks',
    'Connect to Network',
    'Disconnect from Current Network',
    'Start Hotspot',
    'Stop Hotspot',
    'Show Detailed Status', // This will call showDynamicMultiPageStatusScreen
    'WireGuard VPN Management',
    'Network Configuration Management',
    'Network Diagnostics',
    'Connected Devices',
    'Boot Configuration',
    'About WorkHive',
    'Exit',
];

async function updateStatusHeader() {
    if (!statusHeaderBox || !networkControl || !screen) return;

    try {
        const status = await networkControl.getStatus();
        const vpn = await networkControl.getWireGuardStatus();
        const rawPubIp = await getPublicIp();
        const pubIp = rawPubIp !== 'Not available' ? rawPubIp : 'N/A';

        let fullHeaderText = `Interface: {yellow-fg}${status.interfaceName || 'N/A'}{/yellow-fg} | Mode: {cyan-fg}${status.mode}{/cyan-fg} | `;
        fullHeaderText += `Status: ${status.connected ? `{green-fg}Connected (${status.ssid || 'N/A'}){/green-fg}` : '{red-fg}Disconnected{/red-fg}'} | `;
        fullHeaderText += `Public IP: {magenta-fg}${pubIp}{/magenta-fg} | `;
        fullHeaderText += `VPN: ${vpn.active ? '{green-fg}Active{/green-fg}' : '{red-fg}Inactive{/red-fg}'}`;

        // Get the effective content width of the box
        const maxWidth = statusHeaderBox.iwidth as number;

        let line1 = fullHeaderText;
        let line2 = '';

        // Use blessed.stripTags for length calculation before splitting
        if (blessed.stripTags(fullHeaderText).length > maxWidth) {
            let splitAt = -1;
            let currentVisibleCharsInLine1 = 0;
            let potentialSplitPoint = -1;

            for (let i = 0; i < fullHeaderText.length; i++) {
                let char = fullHeaderText[i];
                if (char === '{' && fullHeaderText.indexOf('}', i) !== -1) {
                    const tagCloseIndex = fullHeaderText.indexOf('}', i);
                    i = tagCloseIndex;
                    continue;
                }

                currentVisibleCharsInLine1++; // Count visible characters

                if (currentVisibleCharsInLine1 <= maxWidth) {
                    if (char === '|') {
                        potentialSplitPoint = i + 1;
                    } else if (char === ' ' && (potentialSplitPoint === -1 || (fullHeaderText[potentialSplitPoint - 1] !== '|'))) {
                        potentialSplitPoint = i + 1;
                    }
                } else {
                    splitAt = (potentialSplitPoint !== -1) ? potentialSplitPoint : i;
                    break;
                }
            }

            if (splitAt !== -1 && splitAt < fullHeaderText.length) {
                line1 = fullHeaderText.substring(0, splitAt);
                line2 = fullHeaderText.substring(splitAt).trim();
            } else if (splitAt === -1 && blessed.stripTags(fullHeaderText).length > maxWidth) {
                // No natural split point found, and text is too long for one line.
            }
        }

        // Use blessed.stripTags for length calculation before truncating
        if (blessed.stripTags(line1).length > maxWidth) {
            line1 = smartTruncateTagAware(line1, maxWidth - 1) + '…';
        }

        if (line2) {
            if (blessed.stripTags(line2).length > maxWidth) {
                line2 = smartTruncateTagAware(line2, maxWidth - 1) + '…';
            }
        }

        statusHeaderBox.setContent(`{center}${line1.trim()}{/center}\n{center}${line2.trim()}{/center}`);
        screen?.render();
    } catch (error) {
        statusHeaderBox.setContent(`{center}{red-fg}Error updating status: ${(error as Error).message}{/red-fg}{/center}\n{center}{red-fg}Check logs for details.{/red-fg}{/center}`);
        screen?.render();
    }
}

function showMessageInInteractionPane(title: string, message: string, type: 'info' | 'error' | 'success' = 'info') {
    if (!interactionPane || !screen) return;

    interactionPane.setLabel(` ${title} `);
    const color = type === 'error' ? '{red-fg}' : (type === 'success' ? '{green-fg}' : '{blue-fg}');
    interactionPane.setContent(`${color}${message}{/}`);
    screen.render();
}

function clearInteractionPane() {
    if (!interactionPane || !screen) return;
    interactionPane.setLabel(' Output ');
    interactionPane.setContent('');
    screen.render();
}

async function handleMenuSelection(item: blessed.Widgets.BlessedElement, index: number) {
    const selectedOption = mainMenuItems[index];
    if (!interactionPane || !screen || !networkControl || !logBox) return;

    interactionPane.setContent('');
    logBox.setContent('');

    switch (selectedOption) {
        case 'Scan for Networks':
            interactionPane.setLabel(' Network Scan Results ');
            interactionPane.setContent('Scanning... please wait.');
            screen.render();
            try {
                const networks = await networkControl.scanNetworks();
                if (networks.length === 0) {
                    interactionPane.setContent('No networks found.');
                } else {
                    const networkList = blessed.list({
                        parent: interactionPane,
                        top: 0,
                        left: 0,
                        width: '100%',
                        height: '100%',
                        items: networks.map(n => `${n.ssid || '{italic}Hidden SSID{/italic}'} (Sig: ${n.signal}%, Sec: ${n.security?.join(', ') || 'Open'}, Freq: ${n.freq || 'N/A'})`),
                        keys: true,
                        vi: true,
                        mouse: true,
                        tags: true,
                        style: {
                            fg: 'white',
                            selected: { bg: 'blue', fg: 'white', bold: true },
                            item: { hover: { bg: 'green' } }
                        },
                        border: { type: 'line' },
                        scrollbar: { ch: ' ', track: { bg: 'cyan' } },
                    });
                    if (networks.length > 0) {
                        networkList.select(0);
                    }
                    networkList.focus();

                    networkList.key(['escape', 'left'], () => {
                        networkList.destroy();
                        if (screen && interactionPane) {
                            interactionPane.setContent('');
                            interactionPane.setLabel(' Output ');
                            if (mainMenuList) {
                                mainMenuList.focus();
                            }
                            screen.render();
                        }
                    });
                }
            } catch (error) {
                interactionPane.setContent(`{red-fg}Error scanning networks: ${(error as Error).message}{/red-fg}`);
            }
            screen.render();
            break;

        case 'Show Detailed Status':
            if (screen) {
                screen.destroy();
                screen = null;
                statusHeaderBox = null;
                mainMenuList = null;
                interactionPane = null;
                logBox = null;
            }
            await showDynamicMultiPageStatusScreen(networkControl);
            if (networkControl) launchMainTUI(networkControl);
            return;

        case 'Exit':
            screen?.destroy();
            screen = null;
            statusHeaderBox = null;
            mainMenuList = null;
            interactionPane = null;
            logBox = null;
            process.exit(0);
            break;

        case 'Connect to Network':
        case 'Disconnect from Current Network':
        case 'Start Hotspot':
        case 'Stop Hotspot':
        case 'WireGuard VPN Management':
        case 'Network Configuration Management':
        case 'Network Diagnostics':
        case 'Connected Devices':
        case 'Boot Configuration':
        case 'About WorkHive':
            showMessageInInteractionPane('Info', `Selected: ${selectedOption}
Functionality not yet implemented.`, 'info');
            mainMenuList?.focus();
            break;

        default:
            showMessageInInteractionPane('Warning', `Unknown option: ${selectedOption}`, 'info');
            mainMenuList?.focus();
            break;
    }
}

export async function launchMainTUI(nc: NetworkControl) {
    networkControl = nc;

    screen = blessed.screen({
        smartCSR: true,
        title: mainMenuTitle,
        fullUnicode: true,
        dockBorders: true,
    });

    statusHeaderBox = blessed.box({
        parent: screen,
        top: 0,
        left: 0,
        width: '100%',
        height: 2,
        tags: true,
        style: { fg: 'white', bg: 'blue' },
        content: '{center}Loading status...{/center}\n ',
    });

    mainMenuList = blessed.list({
        parent: screen,
        top: 2,
        left: 0,
        width: '30%',
        height: '100%-2-3',
        label: ' Main Menu ',
        items: mainMenuItems,
        keys: true,
        vi: true,
        mouse: true,
        border: { type: 'line' },
        style: {
            fg: 'white',
            bg: 'black',
            border: { fg: 'cyan' },
            selected: { bg: 'blue', fg: 'white', bold: true },
            item: { hover: { bg: 'green' } }
        },
        scrollbar: { ch: ' ', track: { bg: 'cyan' } },
    });

    interactionPane = blessed.box({
        parent: screen,
        top: 2,
        left: '30%',
        width: '70%',
        height: '100%-2-3',
        label: ' Output ',
        content: '{center}Select an option from the menu.{/center}',
        tags: true,
        border: { type: 'line' },
        style: { fg: 'white', border: { fg: 'cyan' } },
        scrollable: true,
        alwaysScroll: true,
        scrollbar: { ch: ' ', track: { bg: 'grey' }, style: { inverse: true } },
        keys: true,
        vi: true,
    });

    logBox = blessed.log({
        parent: screen,
        bottom: 0,
        left: 0,
        width: '100%',
        height: 3,
        label: ' Log ',
        tags: true,
        border: { type: 'line' },
        style: { fg: 'white', border: { fg: 'yellow' } },
        scrollable: true,
        alwaysScroll: true,
        scrollbar: { ch: ' ', track: { bg: 'grey' } },
    });

    mainMenuList.on('select', handleMenuSelection);
    mainMenuList.focus();

    screen.key(['escape', 'q'], () => {
        if (screen) {
            screen.destroy();
            screen = null;
            statusHeaderBox = null;
            mainMenuList = null;
            interactionPane = null;
            logBox = null;
        }
        process.exit(0);
    });

    screen.key(['c', 'C-c'], (ch, key) => {
        if (key.ctrl && key.name === 'c') {
            if (screen) {
                screen.destroy();
                screen = null;
                statusHeaderBox = null;
                mainMenuList = null;
                interactionPane = null;
                logBox = null;
            }
            process.exit(0);
        }
    });

    await updateStatusHeader();
    setInterval(updateStatusHeader, 5000);

    screen.render();

    if (logBox) {
        logBox.log(`{blue-fg}WorkHive TUI started. Use arrow keys, Enter to select. Press 'h' for help.{/blue-fg}`);
    }
    screen.render();

    screen.key(['h'], () => {
        showHelpScreen();
    });
}

function showHelpScreen() {
    if (!screen) return;

    const helpContent = `
{bold}{underline}WorkHive TUI - Help{/underline}{/bold}

{bold}Global Keys:{/bold}
  {cyan-fg}Esc, q, Ctrl+C{/cyan-fg} : Exit the application
  {cyan-fg}h{/cyan-fg}              : Show this help screen

{bold}Main Menu ({yellow-fg}Left Pane{/yellow-fg}):{/bold}
  {cyan-fg}Up/Down Arrows{/cyan-fg}  : Navigate menu items
  {cyan-fg}Enter{/cyan-fg}           : Select menu item

{bold}Interaction Pane ({yellow-fg}Right Pane{/yellow-fg}):{/bold}
  Navigation and interaction depends on the selected menu item.
  {cyan-fg}Up/Down Arrows{/cyan-fg}  : Scroll content (if scrollable)
  {cyan-fg}PageUp/PageDown{/cyan-fg}: Scroll content faster

{bold}Network Scan Results (in Interaction Pane):{/bold}
  {cyan-fg}Up/Down Arrows{/cyan-fg}  : Navigate scanned networks
  {cyan-fg}Enter{/cyan-fg}           : Select network (future: for connection)
  {cyan-fg}Esc, Left Arrow{/cyan-fg} : Return to Main Menu

{bold}Detailed Status Screen (Full Screen View):{/bold}
  {cyan-fg}1, 2, 3, 4, 5{/cyan-fg}   : Jump to page
  {cyan-fg}Left/Right Arrows{/cyan-fg}: Navigate pages (wraps around)
  {cyan-fg}Esc, q{/cyan-fg}          : Close status screen and return to Main TUI

{right}Press Esc to close Help{/right}
`;

    const helpBox = blessed.box({
        parent: screen,
        top: 'center',
        left: 'center',
        width: '70%',
        height: '70%',
        content: helpContent,
        tags: true,
        border: { type: 'line' },
        style: {
            fg: 'white',
            bg: 'black',
            border: { fg: 'green' },
        },
        scrollable: true,
        alwaysScroll: true,
        scrollbar: { ch: ' ', track: { bg: 'grey' } },
        keys: true,
        vi: true,
    });

    helpBox.focus();
    helpBox.key(['escape'], () => {
        helpBox.destroy();
        if (mainMenuList) mainMenuList.focus();
        screen?.render();
    });

    screen.render();
}

export async function showDynamicMultiPageStatusScreen(networkControlInstance: NetworkControl) {
    const detailedStatusScreen = blessed.screen({
        smartCSR: true,
        title: 'WorkHive Network Status (Press Q or Esc to exit, <- / -> to navigate)',
        fullUnicode: true,
    });

    const headerHeight = 3;

    const headerBox = blessed.box({
        parent: detailedStatusScreen,
        top: 0,
        left: 0,
        width: '100%',
        height: headerHeight,
        tags: true,
        style: { fg: 'white', bg: 'blue' },
    });

    const contentBox = blessed.box({
        parent: detailedStatusScreen,
        top: headerHeight,
        left: 0,
        width: '100%',
        height: `100%-${headerHeight}`,
        content: 'Loading status...',
        tags: true,
        border: { type: 'line' },
        style: { fg: 'white', border: { fg: '#f0f0f0' } },
        scrollable: true,
        alwaysScroll: true,
        scrollbar: { ch: ' ', track: { bg: 'cyan' }, style: { inverse: true } },
        keys: true,
        vi: true,
    });

    detailedStatusScreen.append(headerBox);
    detailedStatusScreen.append(contentBox);

    let currentPage = 1;
    let currentStatusData: StatusData | null = null;
    const refreshIntervalMs = 2000;

    function getOverviewContent(status: StatusData | null): string {
        if (!status) return '{center}Fetching data...{/center}';
        let c = '{bold}Network Overview{/bold}\n\n';
        c += `Interface: {yellow-fg}${status.interfaceName || 'N/A'}{/yellow-fg}\n`;
        c += `Mode: {cyan-fg}${status.mode}{/cyan-fg}\n`;
        c += `Connected: ${status.connected ? '{green-fg}Yes{/green-fg}' : '{red-fg}No{/red-fg}'}\n`;
        if (status.connected) {
            c += `SSID/Network: {blue-fg}${status.ssid || 'N/A'}{/blue-fg}\n`;
        }
        c += `Public IP: {magenta-fg}${status.publicIp || (status.connected ? 'Resolving...' : 'N/A')}{/magenta-fg}\n`;

        c += `VPN Status: `;
        if (status.vpnDetails) {
            if (status.vpnDetails.active) {
                c += `{green-fg}Active{/green-fg}`;
                if (status.vpnDetails.endpoint) c += ` (Endpoint: ${status.vpnDetails.endpoint})`;
                c += '\n';
            } else {
                c += `{red-fg}Inactive{/red-fg}\n`;
            }
        } else {
            c += '{yellow-fg}Loading...{/yellow-fg}\n';
        }
        c += '\n\n{grey-fg}Navigate: Left/Right Arrows or Number Keys (1-5){/grey-fg}';
        return c;
    }

    function getWifiDetailsContent(status: StatusData | null): string {
        if (!status) return '{center}Fetching data...{/center}';
        if (status.mode !== 'wifi' || !status.connected) {
            return '{center}Not connected to Wi-Fi or Wi-Fi mode not active.\n\n{grey-fg}Navigate: Left/Right Arrows or Number Keys (1-5){/grey-fg}{/center}';
        }
        let c = '{bold}Wi-Fi Details{/bold}\n\n';
        c += `SSID: {blue-fg}${status.ssid || 'N/A'}{/blue-fg}\n`;
        c += `Signal Strength: ${status.signal !== undefined ? status.signal + '%' : 'N/A'}\n`;
        c += `Frequency: ${status.freq || 'N/A'}\n`;
        c += `Bitrate: ${status.bitrate || 'N/A'}\n`;
        c += `Security: ${status.security && status.security.length > 0 ? status.security.join(', ') : 'Open'}\n`;
        c += '\n\n{grey-fg}Navigate: Left/Right Arrows or Number Keys (1-5){/grey-fg}';
        return c;
    }

    function getIpConfigContent(status: StatusData | null): string {
        if (!status) return '{center}Fetching data...{/center}';
        if (!status.connected) {
            return '{center}Not connected.\n\n{grey-fg}Navigate: Left/Right Arrows or Number Keys (1-5){/grey-fg}{/center}';
        }
        let c = '{bold}IP & MAC Configuration{/bold}\n\n';
        c += `IP Address: ${status.ipAddress || 'N/A'}\n`;
        c += `Gateway: ${status.gateway || 'N/A'}\n`;
        c += `MAC Address: ${status.macAddress || 'N/A'}\n`;
        c += `Interface Name: ${status.interfaceName || 'N/A'}\n`;
        c += '\n\n{grey-fg}Navigate: Left/Right Arrows or Number Keys (1-5){/grey-fg}';
        return c;
    }

    function getConnectivityContent(status: StatusData | null): string {
        if (!status) return '{center}Fetching data...{/center}';
        let c = '{bold}Connectivity Status{/bold}\n\n';
        if (!status.connected) {
            return c + '{center}{yellow-fg}Device not connected to any network.\n\n{grey-fg}Navigate: Left/Right Arrows or Number Keys (1-5){/grey-fg}{/yellow-fg}{/center}';
        }
        c += `Gateway Reachable: ${status.pingGatewayOk ? '{green-fg}Yes{/green-fg}' : '{red-fg}No{/red-fg}'} (Ping to ${status.gateway || 'N/A'})\n`;
        c += `Internet Reachable: ${status.pingInternetOk ? '{green-fg}Yes{/green-fg}' : '{red-fg}No{/red-fg}'} (Ping to 8.8.8.8)\n`;
        c += `Public IP Address: {magenta-fg}${status.publicIp || (status.pingInternetOk ? 'Resolving...' : 'N/A')}{/magenta-fg}\n`;
        c += '\n\n{grey-fg}Navigate: Left/Right Arrows or Number Keys (1-5){/grey-fg}';
        return c;
    }

    function getVpnDetailsContent(status: StatusData | null): string {
        if (!status || !status.vpnDetails) return '{center}Fetching VPN data...\n\n{grey-fg}Navigate: Left/Right Arrows or Number Keys (1-5){/grey-fg}{/center}';
        let c = '{bold}WireGuard VPN Details{/bold}\n\n';
        const vpn = status.vpnDetails;
        c += `Status: ${vpn.active ? '{green-fg}Active{/green-fg}' : '{red-fg}Inactive{/red-fg}'}\n`;
        if (vpn.active) {
            c += `Public Key: ${vpn.publicKey || 'N/A'}\n`;
            c += `Endpoint: ${vpn.endpoint || 'N/A'}\n`;
            c += `Latest Handshake: ${vpn.lastHandshake || 'N/A'}\n`;
            c += `Transfer RX: ${vpn.transferRx || 'N/A'}\n`;
            c += `Transfer TX: ${vpn.transferTx || 'N/A'}\n`;
        }
        c += '\n\n{grey-fg}Navigate: Left/Right Arrows or Number Keys (1-5){/grey-fg}';
        return c;
    }

    async function renderCurrentPageContent() {
        let contentToDisplay = '';
        let headerContent = '';

        switch (currentPage) {
            case 1:
                contentToDisplay = getOverviewContent(currentStatusData);
                headerContent = '{center}[1: Overview]  2: Wi-Fi  3: IP/MAC  4: Conn  5: VPN  | <- Prev | Next -> | Q: Quit{/center}';
                break;
            case 2:
                contentToDisplay = getWifiDetailsContent(currentStatusData);
                headerContent = '{center}1: Overview  [2: Wi-Fi]  3: IP/MAC  4: Conn  5: VPN  | <- Prev | Next -> | Q: Quit{/center}';
                break;
            case 3:
                contentToDisplay = getIpConfigContent(currentStatusData);
                headerContent = '{center}1: Overview  2: Wi-Fi  [3: IP/MAC]  4: Conn  5: VPN  | <- Prev | Next -> | Q: Quit{/center}';
                break;
            case 4:
                contentToDisplay = getConnectivityContent(currentStatusData);
                headerContent = '{center}1: Overview  2: Wi-Fi  3: IP/MAC  [4: Conn]  5: VPN  | <- Prev | Next -> | Q: Quit{/center}';
                break;
            case 5:
                contentToDisplay = getVpnDetailsContent(currentStatusData);
                headerContent = '{center}1: Overview  2: Wi-Fi  3: IP/MAC  4: Conn  [5: VPN]  | <- Prev | Next -> | Q: Quit{/center}';
                break;
            default:
                contentToDisplay = '{red-fg}Invalid page.{/red-fg}';
                headerContent = '{center}Error - Invalid Page | Q: Quit{/center}';
        }
        headerBox.setContent(headerContent);
        contentBox.setContent(contentToDisplay);
        if (currentPageChanged) {
            contentBox.setScrollPerc(0);
            currentPageChanged = false;
        }
        detailedStatusScreen.render();
    }

    let currentPageChanged = true;

    async function fetchDataAndRender() {
        let status: any;
        let vpn: WireGuardStatus | undefined;
        let pubIp: string | undefined;
        let pingGatewayResult = false;
        let pingInternetResult = false;

        try {
            status = await networkControlInstance.getStatus();
            vpn = await networkControlInstance.getWireGuardStatus();
            const rawPubIp = await getPublicIp();
            pubIp = rawPubIp !== 'Not available' ? rawPubIp : undefined;

            if (status && status.connected && status.gateway) {
                try {
                    await executeCommand(`ping -c 1 -W 1 ${status.gateway}`, false);
                    pingGatewayResult = true;
                } catch (e) { }
            }
            if (status && status.connected) {
                try {
                    await executeCommand(`ping -c 1 -W 1 8.8.8.8`, false);
                    pingInternetResult = true;
                } catch (e) { }
            }

            currentStatusData = {
                ...(status as StatusData),
                publicIp: pubIp,
                vpnDetails: vpn,
                pingGatewayOk: pingGatewayResult,
                pingInternetOk: pingInternetResult,
            };

        } catch (err) {
            currentStatusData = {
                connected: false,
                mode: 'unknown',
                publicIp: undefined,
                vpnDetails: { active: false },
                pingGatewayOk: false,
                pingInternetOk: false,
            } as StatusData;
            contentBox.setContent(`{red-fg}Error fetching status: ${(err as Error).message}{/red-fg}`);
        }
        renderCurrentPageContent();
    }

    await fetchDataAndRender();

    const refreshTimer = setInterval(fetchDataAndRender, refreshIntervalMs);

    detailedStatusScreen.key(['1', '2', '3', '4', '5'], async (ch: string, key: { name: string }) => {
        const newPage = parseInt(key.name);
        if (newPage !== currentPage && [1, 2, 3, 4, 5].includes(newPage)) {
            currentPage = newPage;
            currentPageChanged = true;
            await fetchDataAndRender();
        }
    });

    detailedStatusScreen.key(['left', 'right'], async (ch: string, key: { name: string }) => {
        let newPage = currentPage;
        if (key.name === 'left') {
            newPage = currentPage > 1 ? currentPage - 1 : 5;
        } else if (key.name === 'right') {
            newPage = currentPage < 5 ? currentPage + 1 : 1;
        }
        if (newPage !== currentPage) {
            currentPage = newPage;
            currentPageChanged = true;
            await fetchDataAndRender();
        }
    });

    detailedStatusScreen.key(['escape', 'q', 'C-c'], () => {
        clearInterval(refreshTimer);
        detailedStatusScreen.destroy();
    });

    contentBox.focus();
    detailedStatusScreen.render();
}