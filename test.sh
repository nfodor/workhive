#!/bin/bash
# test.sh - Comprehensive test script for WiFi Manager
# Created: May 16, 2025

# Set colors for better readability
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Utility functions
print_header() {
  echo -e "\n${BLUE}====== $1 ======${NC}\n"
}

print_success() {
  echo -e "${GREEN}✓ $1${NC}"
}

print_error() {
  echo -e "${RED}✗ $1${NC}"
}

print_info() {
  echo -e "${YELLOW}→ $1${NC}"
}

print_result() {
  if [ $1 -eq 0 ]; then
    print_success "$2"
    return 0
  else
    print_error "$3"
    return 1
  fi
}

# Create test results directory
TEST_RESULTS_DIR="test-results"
TIMESTAMP=$(date +"%Y%m%d-%H%M%S")
mkdir -p "$TEST_RESULTS_DIR"

# Path to the compiled CLI
CLI_PATH="dist/cli.js"
RESULTS_FILE="$TEST_RESULTS_DIR/test-results-$TIMESTAMP.log"

# Make sure we're in the right directory
cd "$(dirname "$0")" || exit 1

# Start logging
echo "WiFi Manager Test Results - $(date)" > "$RESULTS_FILE"
echo "=================================" >> "$RESULTS_FILE"

# Test 1: Build the project
print_header "Building the project"
echo "Building the project..." | tee -a "$RESULTS_FILE"
npm run build > "$TEST_RESULTS_DIR/build-output.log" 2>&1
build_result=$?
print_result $build_result "Build successful" "Build failed, check $TEST_RESULTS_DIR/build-output.log" | tee -a "$RESULTS_FILE"

# Exit if build fails
if [ $build_result -ne 0 ]; then
  print_error "Build failed, can't continue with tests" | tee -a "$RESULTS_FILE"
  exit 1
fi

print_info "Checking if the script is executable..." | tee -a "$RESULTS_FILE"
if [ -x "$CLI_PATH" ]; then
  print_success "Script is executable" | tee -a "$RESULTS_FILE"
else
  print_info "Making script executable..." | tee -a "$RESULTS_FILE"
  chmod +x "$CLI_PATH"
  if [ $? -eq 0 ]; then
    print_success "Script is now executable" | tee -a "$RESULTS_FILE"
  else
    print_error "Failed to make script executable" | tee -a "$RESULTS_FILE"
  fi
fi

# Test 2: Check version and help
print_header "Testing basic CLI functions"
echo "Testing version command..." | tee -a "$RESULTS_FILE"
VERSION_OUTPUT=$(node "$CLI_PATH" --version 2>&1)
if [[ "$VERSION_OUTPUT" =~ [0-9]+\.[0-9]+\.[0-9]+ ]]; then
  print_success "Version check passed: $VERSION_OUTPUT" | tee -a "$RESULTS_FILE"
else
  print_error "Version check failed" | tee -a "$RESULTS_FILE"
fi

echo "Testing help command..." | tee -a "$RESULTS_FILE"
HELP_OUTPUT=$(node "$CLI_PATH" --help 2>&1)
if [[ "$HELP_OUTPUT" == *"WiFi Management CLI"* ]]; then
  print_success "Help command works correctly" | tee -a "$RESULTS_FILE"
else
  print_error "Help command failed" | tee -a "$RESULTS_FILE"
fi

# Test 3: Network Status
print_header "Testing Network Status"
echo "Fetching network status..." | tee -a "$RESULTS_FILE"
node "$CLI_PATH" status > "$TEST_RESULTS_DIR/status-output.log" 2>&1
status_result=$?
if [ $status_result -eq 0 ] && grep -q "NETWORK STATUS" "$TEST_RESULTS_DIR/status-output.log"; then
  print_success "Network status check passed" | tee -a "$RESULTS_FILE"
  print_info "Current network details saved to $TEST_RESULTS_DIR/status-output.log" | tee -a "$RESULTS_FILE"
else
  print_error "Network status check failed" | tee -a "$RESULTS_FILE"
fi

# Test 4: Network Scanning
print_header "Testing Network Scanning"
echo "Scanning for networks..." | tee -a "$RESULTS_FILE"
node "$CLI_PATH" scan > "$TEST_RESULTS_DIR/scan-output.log" 2>&1
scan_result=$?
if [ $scan_result -eq 0 ]; then
  NETWORK_COUNT=$(grep -c "^[0-9]\+\." "$TEST_RESULTS_DIR/scan-output.log")
  if [ "$NETWORK_COUNT" -gt 0 ]; then
    print_success "Network scan detected $NETWORK_COUNT networks" | tee -a "$RESULTS_FILE"
  else
    print_info "Network scan completed, but no networks were found" | tee -a "$RESULTS_FILE"
  fi
else
  print_error "Network scan failed" | tee -a "$RESULTS_FILE"
fi

# Test 5: Configuration Export
print_header "Testing Configuration Export/Import"
echo "Testing configuration export..." | tee -a "$RESULTS_FILE"
EXPORT_FILENAME="test-export-$TIMESTAMP.json"
node "$CLI_PATH" config export -f "$EXPORT_FILENAME" > "$TEST_RESULTS_DIR/config-export.log" 2>&1
export_result=$?

if [ $export_result -eq 0 ] && grep -q "Configurations successfully exported" "$TEST_RESULTS_DIR/config-export.log"; then
  EXPORT_PATH=$(grep -o "/home/pi/wifi_exports/.*\.json" "$TEST_RESULTS_DIR/config-export.log")
  print_success "Configuration export successful to $EXPORT_PATH" | tee -a "$RESULTS_FILE"
  
  # Check if export file exists and has content
  if [ -f "$EXPORT_PATH" ] && [ -s "$EXPORT_PATH" ]; then
    print_success "Export file exists and has content" | tee -a "$RESULTS_FILE"
    # Optional: Check file structure
    if grep -q "networks" "$EXPORT_PATH"; then
      print_success "Export file has the correct structure" | tee -a "$RESULTS_FILE"
    else
      print_error "Export file structure appears incorrect" | tee -a "$RESULTS_FILE"
    fi
  else
    print_error "Export file is missing or empty" | tee -a "$RESULTS_FILE"
  fi
else
  print_error "Configuration export failed" | tee -a "$RESULTS_FILE"
fi

# Test 6: VPN Functionality
print_header "Testing VPN Functionality"
echo "Checking VPN status..." | tee -a "$RESULTS_FILE"
node "$CLI_PATH" vpn status > "$TEST_RESULTS_DIR/vpn-status.log" 2>&1
vpn_status_result=$?

if [ $vpn_status_result -eq 0 ]; then
  print_success "VPN status check successful" | tee -a "$RESULTS_FILE"
  if grep -q "VPN Status: Connected" "$TEST_RESULTS_DIR/vpn-status.log"; then
    VPN_ACTIVE=true
    print_info "VPN is currently active" | tee -a "$RESULTS_FILE"
  else
    VPN_ACTIVE=false
    print_info "VPN is currently inactive" | tee -a "$RESULTS_FILE"
  fi
else
  print_error "VPN status check failed" | tee -a "$RESULTS_FILE"
  VPN_ACTIVE=false
fi

# Only test stopping if VPN is active
if [ "$VPN_ACTIVE" = true ]; then
  echo "Testing VPN stop functionality..." | tee -a "$RESULTS_FILE"
  node "$CLI_PATH" vpn stop > "$TEST_RESULTS_DIR/vpn-stop.log" 2>&1
  vpn_stop_result=$?
  
  if [ $vpn_stop_result -eq 0 ] && grep -q "VPN stopped successfully" "$TEST_RESULTS_DIR/vpn-stop.log"; then
    print_success "VPN stop functionality works correctly" | tee -a "$RESULTS_FILE"
    
    # Verify VPN is actually stopped
    node "$CLI_PATH" vpn status > "$TEST_RESULTS_DIR/vpn-status-after-stop.log" 2>&1
    if grep -q "VPN Status: Disconnected" "$TEST_RESULTS_DIR/vpn-status-after-stop.log"; then
      print_success "VPN confirmed to be stopped" | tee -a "$RESULTS_FILE"
    else
      print_error "VPN appears to still be running after stop command" | tee -a "$RESULTS_FILE"
    fi
  else
    print_error "VPN stop functionality failed" | tee -a "$RESULTS_FILE"
  fi
else
  echo "Skipping VPN stop test as VPN is not active" | tee -a "$RESULTS_FILE"
fi

# Test 7: VPN Export
print_header "Testing VPN Export"
echo "Testing VPN configuration export..." | tee -a "$RESULTS_FILE"
VPN_EXPORT_FILENAME="test-vpn-export-$TIMESTAMP.json"
node "$CLI_PATH" vpn export -f "$VPN_EXPORT_FILENAME" > "$TEST_RESULTS_DIR/vpn-export.log" 2>&1
vpn_export_result=$?

if [ $vpn_export_result -eq 0 ] && grep -q "WireGuard configuration successfully exported" "$TEST_RESULTS_DIR/vpn-export.log"; then
  VPN_EXPORT_PATH=$(grep -o "/home/pi/wifi_exports/.*\.json" "$TEST_RESULTS_DIR/vpn-export.log")
  print_success "VPN export successful to $VPN_EXPORT_PATH" | tee -a "$RESULTS_FILE"
  
  # Check if export file exists and has content
  if [ -f "$VPN_EXPORT_PATH" ] && [ -s "$VPN_EXPORT_PATH" ]; then
    print_success "VPN export file exists and has content" | tee -a "$RESULTS_FILE"
    # Optional: Check file structure
    if grep -q "wireguard" "$VPN_EXPORT_PATH"; then
      print_success "VPN export file has the correct structure" | tee -a "$RESULTS_FILE"
    else
      print_error "VPN export file structure appears incorrect" | tee -a "$RESULTS_FILE"
    fi
  else
    print_error "VPN export file is missing or empty" | tee -a "$RESULTS_FILE"
  fi
else
  print_error "VPN export functionality failed" | tee -a "$RESULTS_FILE"
fi

# Test 8: Network Diagnostics
print_header "Testing Network Diagnostics"
echo "Running basic network diagnostics..." | tee -a "$RESULTS_FILE"
node "$CLI_PATH" debug > "$TEST_RESULTS_DIR/debug-output.log" 2>&1
debug_result=$?

if [ $debug_result -eq 0 ] && grep -q "Network Status" "$TEST_RESULTS_DIR/debug-output.log"; then
  print_success "Network diagnostics completed successfully" | tee -a "$RESULTS_FILE"
  print_info "Diagnostics output saved to $TEST_RESULTS_DIR/debug-output.log" | tee -a "$RESULTS_FILE"
else
  print_error "Network diagnostics failed" | tee -a "$RESULTS_FILE"
fi

# Test 9: Global command check
print_header "Testing Global Command Installation"
echo "Checking if wifi-manager is installed globally..." | tee -a "$RESULTS_FILE"
if command -v wifi-manager >/dev/null 2>&1; then
  print_success "wifi-manager is installed globally" | tee -a "$RESULTS_FILE"
  
  echo "Verifying global command works..." | tee -a "$RESULTS_FILE"
  GLOBAL_VERSION=$(wifi-manager --version 2>&1)
  if [[ "$GLOBAL_VERSION" =~ [0-9]+\.[0-9]+\.[0-9]+ ]]; then
    print_success "Global wifi-manager command works: $GLOBAL_VERSION" | tee -a "$RESULTS_FILE"
  else
    print_error "Global wifi-manager command failed" | tee -a "$RESULTS_FILE"
  fi
else
  print_info "wifi-manager is not installed globally, installing now..." | tee -a "$RESULTS_FILE"
  sudo npm link > "$TEST_RESULTS_DIR/npm-link.log" 2>&1
  link_result=$?
  
  if [ $link_result -eq 0 ] && command -v wifi-manager >/dev/null 2>&1; then
    print_success "wifi-manager is now installed globally" | tee -a "$RESULTS_FILE"
  else
    print_error "Failed to install wifi-manager globally" | tee -a "$RESULTS_FILE"
  fi
fi

# Summary
print_header "Test Summary"
echo "Test completed at $(date)" | tee -a "$RESULTS_FILE"
echo "Test results saved to $RESULTS_FILE" | tee -a "$RESULTS_FILE"

# Count successes and failures
SUCCESS_COUNT=$(grep -c "✓" "$RESULTS_FILE")
ERROR_COUNT=$(grep -c "✗" "$RESULTS_FILE")
TOTAL_COUNT=$((SUCCESS_COUNT + ERROR_COUNT))

echo -e "\n${YELLOW}Tests Run: $TOTAL_COUNT${NC}" | tee -a "$RESULTS_FILE"
echo -e "${GREEN}Tests Passed: $SUCCESS_COUNT${NC}" | tee -a "$RESULTS_FILE"
echo -e "${RED}Tests Failed: $ERROR_COUNT${NC}" | tee -a "$RESULTS_FILE"

if [ $ERROR_COUNT -eq 0 ]; then
  echo -e "\n${GREEN}✓ All tests passed successfully!${NC}" | tee -a "$RESULTS_FILE"
  exit 0
else
  echo -e "\n${RED}✗ Some tests failed. Check the logs for details.${NC}" | tee -a "$RESULTS_FILE"
  exit 1
fi
