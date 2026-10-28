#!/bin/bash

# رنگ‌ها برای زیبایی ترمینال
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BLUE}====================================================${NC}"
echo -e "${BLUE}   USPTO Bulk Downloader - Setup Wizard (Linux)     ${NC}"
echo -e "${BLUE}====================================================${NC}\n"

# ۱. بررسی و نصب پیش‌نیازها
echo -e "${YELLOW}[1/5] Checking prerequisites...${NC}"
if ! command -v node &> /dev/null; then
    echo -e "${RED}Node.js is not installed. Installing...${NC}"
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y nodejs
fi

if ! command -v pnpm &> /dev/null; then
    echo -e "${RED}pnpm is not installed. Installing...${NC}"
    sudo npm install -g pnpm
fi
echo -e "${GREEN}✔ Node.js and pnpm are ready.${NC}\n"

# ۲. دریافت اطلاعات دیتابیس
echo -e "${YELLOW}[2/5] Database Configuration${NC}"
read -p "Database Host [127.0.0.1]: " DB_HOST
DB_HOST=${DB_HOST:-127.0.0.1}

read -p "Database Port [3306]: " DB_PORT
DB_PORT=${DB_PORT:-3306}

read -p "Database User [root]: " DB_USER
DB_USER=${DB_USER:-root}

read -s -p "Database Password (leave empty if none): " DB_PASSWORD
echo ""

read -p "Database Name [usptodb]: " DB_NAME
DB_NAME=${DB_NAME:-usptodb}

# ۳. دریافت تنظیمات برنامه
echo -e "\n${YELLOW}[3/5] Application Configuration${NC}"
DEFAULT_DL_DIR="$(pwd)/_download"
read -p "Download Directory [$DEFAULT_DL_DIR]: " DOWNLOAD_DIR
DOWNLOAD_DIR=${DOWNLOAD_DIR:-$DEFAULT_DL_DIR}

echo -e "\nDoes this server have a Desktop GUI (monitor)?"
echo "1) Yes - I want to see the browser (Headless = false)"
echo "2) No  - Run in background (Headless = true) [Recommended for servers]"
read -p "Select [1 or 2, default=2]: " GUI_CHOICE
if [ "$GUI_CHOICE" == "1" ]; then
    HEADLESS="false"
else
    HEADLESS="true"
fi

# ۴. ساخت فایل .env
echo -e "\n${YELLOW}[4/5] Generating .env file...${NC}"
cat <<EOF > .env
# --- Database Settings ---
DB_HOST=$DB_HOST
DB_PORT=$DB_PORT
DB_USER=$DB_USER
DB_PASSWORD=$DB_PASSWORD
DB_NAME=$DB_NAME

# --- App Settings ---
DOWNLOAD_DIR=$DOWNLOAD_DIR
HEADLESS=$HEADLESS
STOP_HOURS=
EOF
chmod 600 .env # محدود کردن دسترسی به فایل حاوی رمز
echo -e "${GREEN}✔ .env file created successfully.${NC}\n"

# ۵. نصب وابستگی‌ها
echo -e "${YELLOW}[5/5] Installing dependencies...${NC}"
pnpm install

echo -e "\nInstalling Playwright system dependencies (requires sudo)..."
sudo npx playwright install-deps
npx playwright install chromium

# ۶. ایمپورت دیتابیس (اختیاری)
if [ -f "usptodb.sql" ]; then
    echo -e "\n${YELLOW}Database File Detected${NC}"
    read -p "Do you want to import 'usptodb.sql' into database '$DB_NAME'? (y/n) [y]: " IMPORT_DB
    IMPORT_DB=${IMPORT_DB:-y}
    
    if [ "$IMPORT_DB" == "y" ]; then
        echo "Importing database..."
        if [ -z "$DB_PASSWORD" ]; then
            mysql -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" "$DB_NAME" < usptodb.sql
        else
            mysql -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" -p"$DB_PASSWORD" "$DB_NAME" < usptodb.sql
        fi
        echo -e "${GREEN}✔ Database imported successfully.${NC}"
    fi
fi

# پایان
echo -e "\n${GREEN}====================================================${NC}"
echo -e "${GREEN}   Setup Complete! 🎉${NC}"
echo -e "${GREEN}====================================================${NC}"
echo -e "To start downloading, run the following command:"
echo -e "${BLUE}pnpm run runner${NC}"
echo -e "\nFor production (running in background with PM2):"
echo -e "${BLUE}sudo npm install -g pm2${NC}"
echo -e "${BLUE}pm2 start pnpm --name \"uspto-bot\" -- run runner${NC}"
echo -e "${BLUE}pm2 save && pm2 startup${NC}\n"