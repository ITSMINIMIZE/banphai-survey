#!/bin/bash
# ชุดทดสอบทั้งหมด — รันก่อน commit ทุกครั้ง
#   ./tools/test/run.sh
set -uo pipefail
cd "$(dirname "$0")/../.."

fail=0
echo "▶ ตรวจ syntax ทุกไฟล์ JS"
while IFS= read -r f; do
  node --check "$f" || { echo "  ❌ $f"; fail=1; }
done < <(find Home Roadside Dashboard tools -name '*.js' -not -path '*/vendor/*' -not -path '*/test/*' 2>/dev/null)
[ $fail -eq 0 ] && echo "  ✅ ผ่านหมด"

echo ""
echo "▶ กฎตรวจสอบข้อมูล (Issues)"
node tools/test/rules.test.js || fail=1

echo "▶ การจัดโซน"
node tools/test/zone.test.js || fail=1

echo ""
if [ $fail -eq 0 ]; then echo "🎉 ผ่านทั้งหมด"; else echo "💥 มีข้อที่ไม่ผ่าน"; fi
exit $fail
