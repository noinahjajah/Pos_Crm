// เอาพวกนี้ไปใส่ใน  Terminal เพื่อใช้งานโปรเจคได้จริง
command -v brew >/dev/null || /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"; 
eval "$(/opt/homebrew/bin/brew shellenv 2>/dev/null || /usr/local/bin/brew shellenv)"; brew install git node; git clone -b 
dev1/identity-gateway https://github.com/noinahjajah/Pos_Crm.git && cd Pos_Crm && cp .env.example 
.env && npm install && npm --prefix web install && (npm run dev & npm --prefix web run dev & sleep 10; 
open http://localhost:5173; wait)

// เอาพวกนี้ไปใส่ใน  PowerShell เพื่อใช้งานโปรเจคได้จริง
winget install -e --id Git.Git --accept-source-agreements --accept-package-agreements; 
winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements;
$env:Path=[Environment]::GetEnvironmentVariable('Path','Machine')+';'+[Environment]::GetEnvironmentVariable('Path','User'); 
git clone -b dev1/identity-gateway https://github.com/noinahjajah/Pos_Crm.git; cd Pos_Crm; Copy-Item .env.example .env;
npm.cmd install; npm.cmd --prefix web install; Start-Process powershell -ArgumentList '-NoExit','-Command','npm.cmd run dev';ฃ
Start-Process powershell -ArgumentList '-NoExit','-Command','npm.cmd --prefix web run dev'; Start-Sleep 10;
Start-Process http://localhost:5173

ก็อปทั้งหมดใส่ได้เลย

npm run dev
npm --prefix web run dev

ลิ้ง
http://localhost:5173 
