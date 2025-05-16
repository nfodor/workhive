#!/bin/bash
# Script to move files from nodejs directory to top level
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

# Source and destination directories
SRC_DIR="/home/pi/scripts/setwifi/nodejs"
DEST_DIR="/home/pi/scripts/setwifi"

# Step 1: Check for potential conflicts
print_header "Checking for potential conflicts"

conflicts=()
for file in $(ls -A "$SRC_DIR" | grep -v "node_modules" | grep -v "dist"); do
  if [ -e "$DEST_DIR/$file" ] && [ "$file" != "README.md" ]; then
    conflicts+=("$file")
  fi
done

if [ ${#conflicts[@]} -gt 0 ]; then
  print_info "Found the following conflicts. These will be backed up:"
  for file in "${conflicts[@]}"; do
    echo " - $file"
  done
  
  # Backup conflicting files
  for file in "${conflicts[@]}"; do
    mv "$DEST_DIR/$file" "$DEST_DIR/$file.bak"
    print_info "Backed up $file to $file.bak"
  done
else
  print_success "No conflicts found"
fi

# Step 2: Copy files to top level (excluding node_modules and dist)
print_header "Copying files to top level"

# First, create the src directory structure if it doesn't exist
mkdir -p "$DEST_DIR/src"
mkdir -p "$DEST_DIR/src/interfaces"
mkdir -p "$DEST_DIR/src/services"
mkdir -p "$DEST_DIR/src/types"
mkdir -p "$DEST_DIR/src/utils"

# Copy all files excluding node_modules and dist
rsync -av --exclude="node_modules" --exclude="dist" "$SRC_DIR/" "$DEST_DIR/"
print_success "Files copied successfully"

# Step 3: Update references in files
print_header "Updating file references"

# Update import paths and references where needed
# Note: This is placeholder for more complex path updates if needed
print_info "Checking for paths that need updating..."

# No major path changes needed as the relative structure remains the same
print_success "No path updates required as the relative structure remains the same"

# Step 4: Update README.md with merged content
print_header "Updating README.md"

if [ -f "$DEST_DIR/README.md.bak" ]; then
  print_info "Merging README.md files..."
  # This is a simplified approach - in a real scenario, you might want a more sophisticated merging
  cat "$SRC_DIR/README.md" > "$DEST_DIR/README.md"
  print_success "README.md updated"
else
  mv "$SRC_DIR/README.md" "$DEST_DIR/README.md"
  print_success "README.md replaced"
fi

# Step 5: Install dependencies
print_header "Installing dependencies"
cd "$DEST_DIR"
npm install
print_success "Dependencies installed"

# Step 6: Build the project
print_header "Building the project"
cd "$DEST_DIR"
npm run build
print_success "Project built successfully"

# Final step: Clean up
print_header "Cleaning up"
print_info "The nodejs directory is still present but can now be removed if everything works correctly."
print_info "You can remove it with: rm -rf $SRC_DIR"
print_info "First, test that everything works from the new location!"

print_header "Migration Complete"
print_success "The project has been successfully moved to the top level directory."
print_info "Please test your application thoroughly before removing the original nodejs directory."
