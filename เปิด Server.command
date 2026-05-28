#!/bin/bash
cd /Users/cmmcbook/Desktop/Claude
echo "🚀 กำลังเปิด Server..."
echo "──────────────────────────"
echo "เข้าใช้งานได้ที่:"
echo "  http://localhost:5500"
echo ""
echo "ปิด Terminal นี้ = ปิด Server"
echo "──────────────────────────"
# เปิด browser อัตโนมัติหลัง server พร้อม (รอ 2 วินาที)
sleep 2 && open "http://localhost:5500/" &

npx serve -l 5500 INTERVIEW
