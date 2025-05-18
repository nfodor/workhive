"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConfigManager = void 0;
var command_util_1 = require("./command.util");
var path = require("path");
var fs = require("fs/promises");
var os = require("os");
var ConfigManager = /** @class */ (function () {
    function ConfigManager() {
        this.dnsmasqConfigPath = '/etc/NetworkManager/dnsmasq.d/custom-dns.conf';
        this.dhcpConfigPath = '/etc/NetworkManager/dnsmasq.d/dhcp-options.conf';
        var homeDir = os.homedir() || '/home/pi';
        this.configDir = path.join(homeDir, '.wifi_configs');
        this.defaultConfigPath = path.join(this.configDir, 'default-config.json');
    }
    ConfigManager.prototype.init = function () {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4 /*yield*/, fs.mkdir(this.configDir, { recursive: true })];
                    case 1:
                        _a.sent();
                        return [2 /*return*/];
                }
            });
        });
    };
    ConfigManager.prototype.saveConfig = function (id, config) {
        return __awaiter(this, void 0, void 0, function () {
            var filePath;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4 /*yield*/, this.init()];
                    case 1:
                        _a.sent();
                        filePath = path.join(this.configDir, "".concat(id, ".json"));
                        return [4 /*yield*/, fs.writeFile(filePath, JSON.stringify(config, null, 2))];
                    case 2:
                        _a.sent();
                        return [2 /*return*/];
                }
            });
        });
    };
    ConfigManager.prototype.loadConfig = function (id) {
        return __awaiter(this, void 0, void 0, function () {
            var filePath, content, _a;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0:
                        _b.trys.push([0, 2, , 3]);
                        filePath = path.join(this.configDir, "".concat(id, ".json"));
                        return [4 /*yield*/, fs.readFile(filePath, 'utf-8')];
                    case 1:
                        content = _b.sent();
                        return [2 /*return*/, JSON.parse(content)];
                    case 2:
                        _a = _b.sent();
                        return [2 /*return*/, null];
                    case 3: return [2 /*return*/];
                }
            });
        });
    };
    ConfigManager.prototype.listConfigs = function () {
        return __awaiter(this, void 0, void 0, function () {
            var files, configs, _i, files_1, file, id, config;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4 /*yield*/, this.init()];
                    case 1:
                        _a.sent();
                        return [4 /*yield*/, fs.readdir(this.configDir)];
                    case 2:
                        files = _a.sent();
                        configs = [];
                        _i = 0, files_1 = files;
                        _a.label = 3;
                    case 3:
                        if (!(_i < files_1.length)) return [3 /*break*/, 6];
                        file = files_1[_i];
                        if (!file.endsWith('.json')) return [3 /*break*/, 5];
                        id = path.basename(file, '.json');
                        return [4 /*yield*/, this.loadConfig(id)];
                    case 4:
                        config = _a.sent();
                        if (config) {
                            configs.push({ id: id, config: config });
                        }
                        _a.label = 5;
                    case 5:
                        _i++;
                        return [3 /*break*/, 3];
                    case 6: return [2 /*return*/, configs];
                }
            });
        });
    };
    ConfigManager.prototype.deduplicateConfigs = function () {
        return __awaiter(this, void 0, void 0, function () {
            var configs, uniqueConfigs, _i, configs_1, _a, id, config, key, currentDate, existing, _b, configs_2, _c, id, config, key, keeper, filePath;
            return __generator(this, function (_d) {
                switch (_d.label) {
                    case 0: return [4 /*yield*/, this.listConfigs()];
                    case 1:
                        configs = _d.sent();
                        uniqueConfigs = new Map();
                        // Group configs by SSID and mode
                        for (_i = 0, configs_1 = configs; _i < configs_1.length; _i++) {
                            _a = configs_1[_i], id = _a.id, config = _a.config;
                            key = "".concat(config.ssid, ":").concat(config.mode);
                            currentDate = new Date(config.createdDate);
                            existing = uniqueConfigs.get(key);
                            if (!existing || new Date(existing.config.createdDate) < currentDate) {
                                uniqueConfigs.set(key, { id: id, config: config, date: currentDate });
                            }
                        }
                        _b = 0, configs_2 = configs;
                        _d.label = 2;
                    case 2:
                        if (!(_b < configs_2.length)) return [3 /*break*/, 5];
                        _c = configs_2[_b], id = _c.id, config = _c.config;
                        key = "".concat(config.ssid, ":").concat(config.mode);
                        keeper = uniqueConfigs.get(key);
                        if (!(keeper && keeper.id !== id)) return [3 /*break*/, 4];
                        filePath = path.join(this.configDir, "".concat(id, ".json"));
                        return [4 /*yield*/, fs.unlink(filePath)];
                    case 3:
                        _d.sent();
                        _d.label = 4;
                    case 4:
                        _b++;
                        return [3 /*break*/, 2];
                    case 5: return [2 /*return*/];
                }
            });
        });
    };
    ConfigManager.prototype.deduplicateNetworkProfiles = function () {
        return __awaiter(this, void 0, void 0, function () {
            var stdout, wifiProfiles, profilesBySSID, _i, wifiProfiles_1, profile, ssid, profiles, _a, _b, _c, _d, ssid, profiles, sortedProfiles, _e, _f, profile;
            var _this = this;
            return __generator(this, function (_g) {
                switch (_g.label) {
                    case 0: return [4 /*yield*/, (0, command_util_1.executeCommand)('nmcli -t -f NAME,TYPE connection')];
                    case 1:
                        stdout = (_g.sent()).stdout;
                        wifiProfiles = stdout.split('\n')
                            .filter(function (line) { return line.includes(':802-11-wireless'); })
                            .map(function (line) { return line.split(':')[0]; });
                        profilesBySSID = new Map();
                        _i = 0, wifiProfiles_1 = wifiProfiles;
                        _g.label = 2;
                    case 2:
                        if (!(_i < wifiProfiles_1.length)) return [3 /*break*/, 7];
                        profile = wifiProfiles_1[_i];
                        _g.label = 3;
                    case 3:
                        _g.trys.push([3, 5, , 6]);
                        return [4 /*yield*/, (0, command_util_1.executeCommand)("nmcli -g 802-11-wireless.ssid connection show \"".concat(profile, "\""))];
                    case 4:
                        ssid = (_g.sent()).stdout;
                        if (ssid) {
                            profiles = profilesBySSID.get(ssid.trim()) || [];
                            profiles.push(profile);
                            profilesBySSID.set(ssid.trim(), profiles);
                        }
                        return [3 /*break*/, 6];
                    case 5:
                        _a = _g.sent();
                        // Skip if we can't get SSID
                        return [3 /*break*/, 6];
                    case 6:
                        _i++;
                        return [3 /*break*/, 2];
                    case 7:
                        _b = 0, _c = profilesBySSID.entries();
                        _g.label = 8;
                    case 8:
                        if (!(_b < _c.length)) return [3 /*break*/, 14];
                        _d = _c[_b], ssid = _d[0], profiles = _d[1];
                        if (!(profiles.length > 1)) return [3 /*break*/, 13];
                        return [4 /*yield*/, Promise.all(profiles.map(function (profile) { return __awaiter(_this, void 0, void 0, function () {
                                var stdout_1, _a;
                                return __generator(this, function (_b) {
                                    switch (_b.label) {
                                        case 0:
                                            _b.trys.push([0, 2, , 3]);
                                            return [4 /*yield*/, (0, command_util_1.executeCommand)("nmcli -g timestamp connection show \"".concat(profile, "\""))];
                                        case 1:
                                            stdout_1 = (_b.sent()).stdout;
                                            return [2 /*return*/, { profile: profile, timestamp: parseInt(stdout_1.trim()) || 0 }];
                                        case 2:
                                            _a = _b.sent();
                                            return [2 /*return*/, { profile: profile, timestamp: 0 }];
                                        case 3: return [2 /*return*/];
                                    }
                                });
                            }); }))];
                    case 9:
                        sortedProfiles = _g.sent();
                        sortedProfiles.sort(function (a, b) { return b.timestamp - a.timestamp; });
                        _e = 0, _f = sortedProfiles.slice(1);
                        _g.label = 10;
                    case 10:
                        if (!(_e < _f.length)) return [3 /*break*/, 13];
                        profile = _f[_e].profile;
                        return [4 /*yield*/, (0, command_util_1.executeCommand)("sudo nmcli connection delete \"".concat(profile, "\""))];
                    case 11:
                        _g.sent();
                        _g.label = 12;
                    case 12:
                        _e++;
                        return [3 /*break*/, 10];
                    case 13:
                        _b++;
                        return [3 /*break*/, 8];
                    case 14: return [2 /*return*/];
                }
            });
        });
    };
    ConfigManager.prototype.updateDeviceAuth = function (allowedMacs) {
        return __awaiter(this, void 0, void 0, function () {
            var config;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        config = allowedMacs.map(function (mac) { return "dhcp-host=".concat(mac); }).join('\n');
                        return [4 /*yield*/, fs.writeFile(this.dhcpConfigPath, config, { encoding: 'utf-8' })];
                    case 1:
                        _a.sent();
                        return [4 /*yield*/, (0, command_util_1.executeCommand)('sudo systemctl restart NetworkManager')];
                    case 2:
                        _a.sent();
                        return [2 /*return*/];
                }
            });
        });
    };
    ConfigManager.prototype.updateDnsConfig = function (servers) {
        return __awaiter(this, void 0, void 0, function () {
            var config;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        config = servers.map(function (server) { return "server=".concat(server); }).join('\n');
                        return [4 /*yield*/, fs.writeFile(this.dnsmasqConfigPath, config, { encoding: 'utf-8' })];
                    case 1:
                        _a.sent();
                        return [4 /*yield*/, (0, command_util_1.executeCommand)('sudo systemctl restart NetworkManager')];
                    case 2:
                        _a.sent();
                        return [2 /*return*/];
                }
            });
        });
    };
    ConfigManager.prototype.setHairpinNAT = function (enable) {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        if (!enable) return [3 /*break*/, 3];
                        return [4 /*yield*/, (0, command_util_1.executeCommand)('sudo sysctl -w net.ipv4.conf.all.route_localnet=1')];
                    case 1:
                        _a.sent();
                        return [4 /*yield*/, (0, command_util_1.executeCommand)('sudo iptables -t nat -A POSTROUTING -o wlan0 -j MASQUERADE')];
                    case 2:
                        _a.sent();
                        return [3 /*break*/, 6];
                    case 3: return [4 /*yield*/, (0, command_util_1.executeCommand)('sudo sysctl -w net.ipv4.conf.all.route_localnet=0')];
                    case 4:
                        _a.sent();
                        return [4 /*yield*/, (0, command_util_1.executeCommand)('sudo iptables -t nat -D POSTROUTING -o wlan0 -j MASQUERADE')];
                    case 5:
                        _a.sent();
                        _a.label = 6;
                    case 6: return [2 /*return*/];
                }
            });
        });
    };
    ConfigManager.prototype.runDiagnostics = function () {
        return __awaiter(this, arguments, void 0, function (deep) {
            var networkStatus, dnsStatus, dhcpStatus, systemLogs, stdout;
            if (deep === void 0) { deep = false; }
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4 /*yield*/, (0, command_util_1.executeCommand)('nmcli device status')];
                    case 1:
                        networkStatus = _a.sent();
                        return [4 /*yield*/, (0, command_util_1.executeCommand)('cat /etc/resolv.conf')];
                    case 2:
                        dnsStatus = _a.sent();
                        return [4 /*yield*/, (0, command_util_1.executeCommand)('ps aux | grep dnsmasq')];
                    case 3:
                        dhcpStatus = _a.sent();
                        if (!deep) return [3 /*break*/, 5];
                        return [4 /*yield*/, (0, command_util_1.executeCommand)('journalctl -u NetworkManager -n 100')];
                    case 4:
                        stdout = (_a.sent()).stdout;
                        systemLogs = stdout.split('\n');
                        _a.label = 5;
                    case 5: return [2 /*return*/, {
                            networkStatus: networkStatus.stdout,
                            dnsStatus: dnsStatus.stdout,
                            dhcpStatus: dhcpStatus.stdout,
                            systemLogs: systemLogs
                        }];
                }
            });
        });
    };
    ConfigManager.prototype.setDefaultConfig = function (id) {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4 /*yield*/, fs.writeFile(this.defaultConfigPath, JSON.stringify({ id: id }), 'utf-8')];
                    case 1:
                        _a.sent();
                        return [2 /*return*/];
                }
            });
        });
    };
    ConfigManager.prototype.getDefaultConfig = function () {
        return __awaiter(this, void 0, void 0, function () {
            var data, id, error_1;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        _a.trys.push([0, 4, , 5]);
                        return [4 /*yield*/, fs.access(this.defaultConfigPath).then(function () { return true; }).catch(function () { return false; })];
                    case 1:
                        if (!_a.sent()) return [3 /*break*/, 3];
                        return [4 /*yield*/, fs.readFile(this.defaultConfigPath, 'utf-8')];
                    case 2:
                        data = _a.sent();
                        id = JSON.parse(data).id;
                        return [2 /*return*/, id];
                    case 3: return [2 /*return*/, null];
                    case 4:
                        error_1 = _a.sent();
                        console.error('Error reading default config:', error_1);
                        return [2 /*return*/, null];
                    case 5: return [2 /*return*/];
                }
            });
        });
    };
    return ConfigManager;
}());
exports.ConfigManager = ConfigManager;
