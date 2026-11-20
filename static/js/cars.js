/**
 * Sawasdee Rental - Fleet Cards, Rate Engine, Car Editor, Schedule & Maintenance ROI
 * Prototype Mixin for App
 */
Object.assign(App.prototype, {
  populateFleetDropdowns() {
    const isEn = (this.currentLang === "EN");
    const allText = isEn ? "All" : "ทั้งหมด";

    // 1. Group Dropdown
    const selGroup = document.getElementById("filter-group");
    if (selGroup) {
      const curVal = selGroup.value;
      const groups = Array.from(new Set(this.cars.map(c => (c.car_group || "").trim()).filter(Boolean))).sort();
      selGroup.innerHTML = `<option value="ทั้งหมด">${allText}</option>` + 
        groups.map(g => `<option value="${g}">${g}</option>`).join("");
      if (curVal && (curVal === "ทั้งหมด" || groups.includes(curVal))) {
        selGroup.value = curVal;
      }
    }

    // 2. Brand Dropdown
    const selBrand = document.getElementById("filter-brand");
    if (selBrand) {
      const curVal = selBrand.value;
      const brands = Array.from(new Set(this.cars.map(c => (c.brand || "").trim()).filter(Boolean))).sort();
      selBrand.innerHTML = `<option value="ทั้งหมด">${allText}</option>` + 
        brands.map(b => `<option value="${b}">${b}</option>`).join("");
      if (curVal && (curVal === "ทั้งหมด" || brands.includes(curVal))) {
        selBrand.value = curVal;
      }
    }

    // 3. Company Dropdown
    const selComp = document.getElementById("filter-company");
    if (selComp) {
      const curVal = selComp.value;
      const companies = Array.from(new Set(this.cars.map(c => (c.company || c.owner_company || "").trim()).filter(Boolean))).sort();
      selComp.innerHTML = `<option value="ทั้งหมด">${allText}</option>` + 
        companies.map(co => `<option value="${co}">${co}</option>`).join("");
      if (curVal && (curVal === "ทั้งหมด" || companies.includes(curVal))) {
        selComp.value = curVal;
      }
    }
  },

  toggleBookingFilterCollapse() {
    this.bookingFilterCollapsed = !this.bookingFilterCollapsed;
    const content = document.getElementById("booking-bar-collapsible-content");
    const txt = document.getElementById("btn-toggle-filter-text");
    const isEn = (this.currentLang === "EN");
    if (content) {
      content.style.display = this.bookingFilterCollapsed ? "none" : "block";
    }
    if (txt) {
      txt.textContent = this.bookingFilterCollapsed
        ? (isEn ? "Show Filters ▾" : "แสดงตัวกรอง ▾")
        : (isEn ? "Hide Filters ▴" : "ซ่อนตัวกรอง ▴");
    }
  },

  resetFleetFilters() {
    const selGroup = document.getElementById("filter-group");
    const selBrand = document.getElementById("filter-brand");
    const selComp = document.getElementById("filter-company");
    const selStatus = document.getElementById("filter-status");
    const sDate = document.getElementById("filter-start-date");
    const sTime = document.getElementById("filter-start-time");
    const eDate = document.getElementById("filter-end-date");
    const eTime = document.getElementById("filter-end-time");
    const sbSearch = document.getElementById("sb-search-input");

    if (selGroup) selGroup.value = "ทั้งหมด";
    if (selBrand) selBrand.value = "ทั้งหมด";
    if (selComp) selComp.value = "ทั้งหมด";
    if (selStatus) selStatus.value = "ทั้งหมด";

    const thNow = this.getThaiDateTime(0);
    const thNext3 = this.getThaiDateTime(3);
    if (sDate) sDate.value = thNow.date;
    if (eDate) eDate.value = thNext3.date;
    if (sTime) sTime.value = thNow.time;
    if (eTime) eTime.value = thNow.time;
    if (sbSearch) sbSearch.value = "";
    this.sidebarSearchKw = "";

    this.loadCars();
    this.onFilterChange();
    this.showToast(this.currentLang === "EN" ? "🔄 All filters have been reset" : "🔄 คืนค่าตัวกรองทั้งหมดเรียบร้อย (เวลาไทย)", "info");
  },

  onDateFilterChange() {
    this.onFilterChange();
    this.loadCars();
  },

  parseIsoDate(dStr) {
    if (!dStr) return null;
    if (dStr instanceof Date) {
      const d = new Date(dStr.getTime());
      d.setHours(0, 0, 0, 0);
      return d;
    }
    const s = String(dStr).trim().split("T")[0];
    if (s.includes("-")) {
      const parts = s.split("-");
      if (parts.length === 3) {
        return new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10), 0, 0, 0, 0);
      }
    }
    if (s.includes("/")) {
      const parts = s.split("/");
      if (parts.length === 3) {
        return new Date(parseInt(parts[2], 10), parseInt(parts[1], 10) - 1, parseInt(parts[0], 10), 0, 0, 0, 0);
      }
    }
    const d = new Date(s);
    if (!isNaN(d.getTime())) {
      d.setHours(0, 0, 0, 0);
      return d;
    }
    return null;
  },

  calcDuration() {
    const isEn = (this.currentLang === "EN");
    const sDate = document.getElementById("filter-start-date")?.value;
    const sTime = document.getElementById("filter-start-time")?.value || "10:00";
    const eDate = document.getElementById("filter-end-date")?.value;
    const eTime = document.getElementById("filter-end-time")?.value || "10:00";

    if (!sDate || !eDate) return { days: 1, text: isEn ? "1 Day" : "1 วัน" };

    const start = new Date(`${sDate}T${sTime}`);
    const end = new Date(`${eDate}T${eTime}`);
    if (end <= start) return { days: 1, text: isEn ? "1 Day (Minimum)" : "1 วัน (ขั้นต่ำ)" };

    const diffMs = end - start;
    const totalHours = Math.floor(diffMs / (1000 * 60 * 60));
    const remMins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
    const baseDays = Math.floor(totalHours / 24);
    const extraHours = totalHours % 24;

    let billableDays = baseDays;
    let desc = "";

    if (extraHours > 4 || (extraHours === 4 && remMins > 0)) {
      billableDays = baseDays + 1;
      desc = isEn
        ? `${billableDays} Days (${billableDays * 24} Hrs · +${extraHours}h OT)`
        : `${billableDays} วัน (${billableDays * 24} ชม. · เกิน ${extraHours} ชม. ปรับเป็น 1 วัน)`;
    } else {
      billableDays = Math.max(1, baseDays);
      if (extraHours > 0 || remMins > 0) {
        desc = isEn
          ? `${billableDays} Days (${billableDays * 24} Hrs · Grace period)`
          : `${billableDays} วัน (${billableDays * 24} ชม. · อนุโลม ≤ 4 ชม.)`;
      } else {
        desc = isEn
          ? `${billableDays} Days (${billableDays * 24} Hrs)`
          : `${billableDays} วัน (${billableDays * 24} ชม.)`;
      }
    }

    return { days: billableDays, text: desc };
  },

  onFilterChange() {
    const dur = this.calcDuration();
    const durTxt = document.getElementById("calc-duration-text");
    if (durTxt) durTxt.textContent = dur.text;

    this.renderFleetCards();
  },

  getCarRates(car) {
    const c = car || {};
    const dayRaw = parseFloat(c.price_day);
    const priceDay = dayRaw > 0 ? dayRaw : parseFloat(c.daily_rate || 1000);
    const rawWeek = parseFloat(c.price_week) > 0 ? parseFloat(c.price_week) : parseFloat(c.weekly_rate || 0);
    const rawMonth = parseFloat(c.price_month) > 0 ? parseFloat(c.price_month) : parseFloat(c.monthly_rate || 0);
    const priceWeek = rawWeek > 0 ? rawWeek : (priceDay * 6);
    const priceMonth = rawMonth > 0 ? rawMonth : (priceDay * 20);
    return { priceDay, priceWeek, priceMonth, day: priceDay, week: priceWeek, month: priceMonth };
  },

  calculateCarRentalPrice(car, days, contractType = "รายวัน") {
    const isEn = (this.currentLang === "EN");
    const { priceDay, priceWeek, priceMonth } = this.getCarRates(car);
    const billableDays = Math.max(1, parseInt(days, 10) || 1);
    let basePrice = 0;
    let breakdownText = "";

    const isWeekly = contractType === "รายสัปดาห์" || contractType === "Weekly";
    const isMonthly = contractType === "รายเดือน" || contractType === "Monthly";

    if (isWeekly) {
      if (billableDays <= 7) {
        basePrice = priceWeek;
        breakdownText = isEn
          ? `Weekly Rate (1 Week): ฿${priceWeek.toLocaleString()} / Week`
          : `เรทรายสัปดาห์ (1 สัปดาห์): ฿${priceWeek.toLocaleString()} / สัปดาห์`;
      } else {
        const weeks = Math.floor(billableDays / 7);
        const remDays = billableDays % 7;
        basePrice = (weeks * priceWeek) + (remDays * priceDay);
        if (remDays === 0) {
          breakdownText = isEn
            ? `Weekly Rate: ${weeks} Weeks (${billableDays} Days) × ฿${priceWeek.toLocaleString()}`
            : `เรทรายสัปดาห์: ${weeks} สัปดาห์ (${billableDays} วัน) × ฿${priceWeek.toLocaleString()}`;
        } else {
          breakdownText = isEn
            ? `Weekly Rate: ${weeks} Weeks (฿${(weeks * priceWeek).toLocaleString()}) + Extra ${remDays} Days (฿${(remDays * priceDay).toLocaleString()})`
            : `เรทรายสัปดาห์: ${weeks} สัปดาห์ (฿${(weeks * priceWeek).toLocaleString()}) + เศษ ${remDays} วัน (฿${(remDays * priceDay).toLocaleString()})`;
        }
      }
    } else if (isMonthly) {
      if (billableDays <= 30) {
        basePrice = priceMonth;
        breakdownText = isEn
          ? `Monthly Rate (1 Month): ฿${priceMonth.toLocaleString()} / Month`
          : `เรทรายเดือน (1 เดือน): ฿${priceMonth.toLocaleString()} / เดือน`;
      } else {
        const months = Math.floor(billableDays / 30);
        const remDays = billableDays % 30;
        basePrice = (months * priceMonth) + (remDays * priceDay);
        if (remDays === 0) {
          breakdownText = isEn
            ? `Monthly Rate: ${months} Months (${billableDays} Days) × ฿${priceMonth.toLocaleString()}`
            : `เรทรายเดือน: ${months} เดือน (${billableDays} วัน) × ฿${priceMonth.toLocaleString()}`;
        } else {
          breakdownText = isEn
            ? `Monthly Rate: ${months} Months (฿${(months * priceMonth).toLocaleString()}) + Extra ${remDays} Days (฿${(remDays * priceDay).toLocaleString()})`
            : `เรทรายเดือน: ${months} เดือน (฿${(months * priceMonth).toLocaleString()}) + เศษ ${remDays} วัน (฿${(remDays * priceDay).toLocaleString()})`;
        }
      }
    } else {
      // รายวัน (Daily)
      basePrice = billableDays * priceDay;
      breakdownText = isEn
        ? `Daily Rate: ${billableDays} Days × ฿${priceDay.toLocaleString()}/day = ฿${basePrice.toLocaleString()}`
        : `เรทรายวัน: ${billableDays} วัน × ฿${priceDay.toLocaleString()}/วัน = ฿${basePrice.toLocaleString()}`;
    }

    return { basePrice, breakdownText, priceDay, priceWeek, priceMonth };
  },

  formatPlateDisplay(plate) {
    const str = String(plate || "").trim();
    const isRed = str.includes("ป้ายแดง") || str.toLowerCase().includes("red");
    const parts = str.split(/\s+/);
    let plateNo = str;
    let province = "กรุงเทพมหานคร";

    if (parts.length >= 3 && ["กรุงเทพ", "กทม", "เชียงใหม่", "ชลบุรี", "ภูเก็ต"].some(pv => parts[parts.length - 1].includes(pv))) {
      plateNo = parts.slice(0, parts.length - 1).join(" ");
      province = parts[parts.length - 1];
    } else if (parts.length === 2 && ["กรุงเทพ", "กทม", "เชียงใหม่", "ชลบุรี", "ภูเก็ต"].some(pv => parts[1].includes(pv))) {
      plateNo = parts[0];
      province = parts[1];
    }
    return { plateNo, province, isRed };
  },

  getCarExpiryAlerts(c, lang = null) {
    const isEn = (lang === "EN" || (!lang && this.currentLang === "EN"));
    const l = isEn ? "EN" : "TH";
    const dict = (window.translations && window.translations[l]) ? window.translations[l] : null;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const checks = [
      { key: "insurance", name: dict ? dict.insurance : (isEn ? "Insurance" : "ประกันภัย"), dateStr: c.insurance_expire_date || c.ins_expiry || c.ins_expire_date || c.insurance_expiry },
      { key: "prb", name: dict ? dict.act : (isEn ? "PRB" : "พ.ร.บ."), dateStr: c.prb_expire_date || c.act_expiry || c.prb_expiry || c.prb_date || c.act_expire_date },
      { key: "tax", name: dict ? dict.tax : (isEn ? "Tax" : "ภาษี"), dateStr: c.tax_expire_date || c.tax_expiry || c.tax_expire }
    ];

    if (!c.is_debt_free && (c.payment_due_date || c.installment_due_date)) {
      checks.push({
        key: "finance",
        name: isEn ? "Payment Due" : "วันตัดงวด",
        dateStr: c.payment_due_date || c.installment_due_date,
        maxDays: 7
      });
    }

    const alerts = [];

    for (const item of checks) {
      if (!item.dateStr || String(item.dateStr).trim() === "-" || String(item.dateStr).trim() === "") continue;
      const cleanDateStr = String(item.dateStr).trim().split("T")[0].split(" ")[0];
      const parts = cleanDateStr.split(/[\/-]/);
      let expD = null;
      if (parts.length === 3) {
        let y = 0, m = 0, d = 0;
        if (parts[0].length === 4) {
          y = parseInt(parts[0], 10);
          m = parseInt(parts[1], 10) - 1;
          d = parseInt(parts[2], 10);
        } else {
          d = parseInt(parts[0], 10);
          m = parseInt(parts[1], 10) - 1;
          y = parseInt(parts[2], 10);
        }
        if (y > 2400) y -= 543;
        expD = new Date(y, m, d);
      }
      if (!expD || isNaN(expD.getTime())) continue;
      expD.setHours(0, 0, 0, 0);
      const diffDays = Math.round((expD.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
      const maxAlertDays = item.maxDays || 30;
      if (diffDays <= maxAlertDays) {
        let badge = null;
        if (diffDays <= 0) {
          const daysAgo = Math.abs(diffDays);
          const txt = (item.key === "finance")
            ? (diffDays === 0
                ? (isEn ? "Payment Due Today!" : "ตัดงวดวันนี้!")
                : (isEn ? `Payment ${daysAgo}d Overdue` : `ตัดงวดเกินกำหนด ${daysAgo} วัน`))
            : ((item.key === "prb" && dict?.prb_alert_expired)
                ? dict.prb_alert_expired
                : (diffDays === 0
                    ? (dict ? `${item.name} ${dict.due_today}` : (isEn ? `${item.name} today` : `${item.name} หมดอายุวันนี้`))
                    : (dict ? `${item.name} ${dict.overdue_days.replace('{days}', daysAgo)}` : (isEn ? `${item.name} ${daysAgo}d overdue` : `${item.name} เกินกำหนด ${daysAgo} วัน`))));
          badge = {
            key: item.key,
            text: txt,
            bg: "#FEE2E2",
            border: "#FECACA",
            color: "#991B1B",
            dot: "#EF4444",
            diff: diffDays
          };
        } else {
          const txt = (item.key === "finance")
            ? (isEn ? `Payment Due in ${diffDays}d` : `ตัดงวดในอีก ${diffDays} วัน`)
            : ((item.key === "prb" && dict?.prb_alert_in_days)
                ? dict.prb_alert_in_days.replace('{days}', diffDays)
                : (dict ? `${item.name} ${dict.in_days.replace('{days}', diffDays)}` : (isEn ? `${item.name} in ${diffDays}d` : `${item.name} เหลือ ${diffDays} วัน`)));
          badge = {
            key: item.key,
            text: txt,
            bg: diffDays <= 3 ? "#FEF2F2" : "#FEF3C7",
            border: diffDays <= 3 ? "#FECACA" : "#FDE68A",
            color: diffDays <= 3 ? "#991B1B" : "#92400E",
            dot: diffDays <= 3 ? "#EF4444" : "#F59E0B",
            diff: diffDays
          };
        }
        if (badge) alerts.push(badge);
      }
    }

    // Sort by diff ascending (expired / most urgent first)
    alerts.sort((a, b) => a.diff - b.diff);
    return alerts;
  },

  getCarExpiryAlert(c, lang = null) {
    const list = this.getCarExpiryAlerts(c, lang);
    return list.length > 0 ? list[0] : null;
  },

  checkFinancePaymentDueAlerts() {
    if (!this.cars || typeof this.cars !== "object") return [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dueCars = [];
    const carList = Array.isArray(this.cars) ? this.cars : Object.values(this.cars);

    for (const c of carList) {
      if (!c || c.is_debt_free || !c.payment_due_date || c.payment_due_date === "-" || c.payment_due_date === "") continue;
      const cleanDateStr = String(c.payment_due_date).trim().split("T")[0].split(" ")[0];
      const parts = cleanDateStr.split(/[\/-]/);
      let expD = null;
      if (parts.length === 3) {
        let y = 0, m = 0, d = 0;
        if (parts[0].length === 4) {
          y = parseInt(parts[0], 10);
          m = parseInt(parts[1], 10) - 1;
          d = parseInt(parts[2], 10);
        } else {
          d = parseInt(parts[0], 10);
          m = parseInt(parts[1], 10) - 1;
          y = parseInt(parts[2], 10);
        }
        if (y > 2400) y -= 543;
        expD = new Date(y, m, d);
      }
      if (!expD || isNaN(expD.getTime())) continue;
      expD.setHours(0, 0, 0, 0);
      const diffDays = Math.round((expD.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
      if (diffDays <= 7) {
        dueCars.push({ plate: c.plate, diffDays, car: c });
      }
    }

    if (dueCars.length > 0 && !this._financeAlertNotified) {
      this._financeAlertNotified = true;
      const count = dueCars.length;
      const isEn = (this.currentLang === "EN");
      const msg = isEn
        ? `⚠️ Finance Alert: ${count} vehicle(s) have installment payment due within 7 days!`
        : `⚠️ แจ้งเตือนวันตัดงวด: มีรถยนต์ ${count} คัน ถึงกำหนดชำระค่างวดภายใน 7 วัน!`;
      this.showToast(msg, "warning");
    }
    return dueCars;
  },

  toggleCarExpander(plate) {
    const safeId = String(plate || "").replace(/[^a-zA-Z0-9]/g, "_");
    const panel = document.getElementById(`exp-panel-${safeId}`);
    const arrow = document.getElementById(`exp-arrow-${safeId}`);
    if (!panel) return;
    const isOpen = panel.classList.contains("active");
    if (isOpen) {
      panel.classList.remove("active");
      if (arrow) arrow.textContent = "▼";
    } else {
      panel.classList.add("active");
      if (arrow) arrow.textContent = "▲";
    }
  },

  renderCars() {
    if (typeof this.renderFleetCards === "function") this.renderFleetCards();
    if (typeof this.renderFleetOverviewTable === "function") this.renderFleetOverviewTable();
  },

  renderExpiringAlerts() {
    if (typeof this.renderFleetOverviewTable === "function") this.renderFleetOverviewTable();
  },

  renderUnifiedExpensesTable() {
    if (typeof this.loadMonthlyExpenses === "function") this.loadMonthlyExpenses();
  },

  renderFleetCards() {
    const container = document.getElementById("fleet-cards-container");
    if (!container) return;

    const isEn = (this.currentLang === "EN");
    const groupFilter = document.getElementById("filter-group")?.value || "ทั้งหมด";
    const brandFilter = document.getElementById("filter-brand")?.value || "ทั้งหมด";
    const companyFilter = document.getElementById("filter-company")?.value || "ทั้งหมด";
    const statusFilter = document.getElementById("filter-status")?.value || "ทั้งหมด";
    const dur = this.calcDuration();
    const kw = (this.sidebarSearchKw || "").toLowerCase().trim();

    const isAllVal = (v) => { const s = String(v == null ? "" : v).trim().toLowerCase(); return s === "" || s === "all" || s === "ทั้งหมด"; };
    const filtered = this.cars.filter(c => {
      // 1. Group filter
      if (!isAllVal(groupFilter)) {
        const cg = (c.car_group || "").toLowerCase();
        if (!cg.includes(groupFilter.toLowerCase())) return false;
      }

      // 2. Brand filter
      if (!isAllVal(brandFilter)) {
        if ((c.brand || "").trim().toLowerCase() !== brandFilter.trim().toLowerCase()) return false;
      }

      // 3. Company filter
      if (!isAllVal(companyFilter)) {
        if ((c.company || c.owner_company || "").trim() !== companyFilter.trim()) return false;
      }

      // 3b. Active Bookings and Date Overlap Calculations
      const normCarPlate = this.normalizePlate(c.plate);
      const activeBookings = (this.bookings || []).filter(b => {
        if (this.normalizePlate(b.car_id) !== normCarPlate) return false;
        const bStat = String(b.status || "").trim();
        return !["เสร็จสิ้น", "ยกเลิก", "Completed", "Canceled", "completed", "canceled"].includes(bStat);
      });
      const hasAnyActiveBooking = activeBookings.length > 0;

      const lockS = document.getElementById("filter-start-date")?.value;
      const lockE = document.getElementById("filter-end-date")?.value;
      let searchS = this.parseIsoDate(lockS);
      let searchE = this.parseIsoDate(lockE);
      if (searchS && !searchE) searchE = new Date(searchS.getTime());
      if (searchE && !searchS) searchS = new Date(searchE.getTime());
      if (searchS && searchE && searchE < searchS) searchE = new Date(searchS.getTime());

      let hasOverlapOnSelectedDates = false;
      if (searchS && searchE) {
        hasOverlapOnSelectedDates = activeBookings.some(b => {
          const bStart = this.parseIsoDate(b.start_date);
          const bEnd = this.parseIsoDate(b.end_date);
          if (!bStart || !bEnd) return false;
          if (bStart.getTime() === bEnd.getTime() || searchS.getTime() === searchE.getTime()) {
            return (searchS <= bEnd) && (searchE >= bStart);
          }
          return (searchS < bEnd) && (searchE > bStart);
        });
      }

      // 4. Status Filter (4 exact options: ทั้งหมด, ว่าง, ติดจอง, กำลังเช่า)
      const cleanStat = String(statusFilter || "").trim();
      const isStatusAll = isAllVal(cleanStat) || cleanStat === "ทั้งหมด" || cleanStat === "All";
      const isStatusAvail = cleanStat === "ว่าง" || cleanStat === "Available";
      const isStatusBooked = cleanStat === "ติดจอง" || cleanStat === "Reserved";
      const isStatusRenting = cleanStat === "กำลังเช่า" || cleanStat === "On Rent" || cleanStat === "Currently Renting";

      const hasBookingOnRent = activeBookings.some(b => b.status === "กำลังเช่า" || b.status === "รอรับคืน");
      const isTrulyOnRent = hasBookingOnRent || (c.is_on_rent && c.status === "กำลังเช่า");

      if (isStatusRenting) {
        // เลือก "กำลังเช่า": แสดงรถที่สถานะปัจจุบันคือ On Rent (ลูกค้ากำลังใช้งาน)
        if (!isTrulyOnRent) return false;
      } else if (isStatusBooked) {
        // เลือก "ติดจอง": แสดงรถที่มีการสร้าง Booking ไว้แล้ว (มีคิวในระบบ) หรือสถานะติดจอง
        if (isTrulyOnRent) return false;
        if (!hasAnyActiveBooking && c.status !== "ติดจอง" && c.fleet_status_key !== "reserved" && c.fleet_status_key !== "unavailable") {
          return false;
        }
      } else if (isStatusAvail) {
        // เลือก "ว่าง": แสดงเฉพาะรถที่ ไม่มี คิวจองทับซ้อน (Overlap) ในช่วงวันที่เลือก และสถานะรถปัจจุบันไม่ใช่ "กำลังเช่า"
        if (isTrulyOnRent || c.status === "กำลังเช่า") return false;
        if (c.fleet_status_key === "maintenance" || c.status === "ซ่อมบำรุง" || c.status === "สถานะซ่อมบำรุง") return false;
        if (c.fleet_status_key === "unavailable" || c.status === "ติดจอง" || c.fleet_status_key === "reserved") return false;
        if (searchS && searchE) {
          if (hasOverlapOnSelectedDates) return false;
        } else {
          // If no specific dates selected, car must not be occupied currently
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          const overlapsToday = activeBookings.some(b => {
            const bs = this.parseIsoDate(b.start_date);
            const be = this.parseIsoDate(b.end_date);
            return bs && be && today >= bs && today <= be;
          });
          if (overlapsToday) return false;
        }
      } else if (isStatusAll) {
        // เลือก "ทั้งหมด": แสดงรถทุกคัน (ที่ผ่านเงื่อนไขตัวกรองวันที่ และหมวดหมู่อื่นๆ)
        if (searchS && searchE) {
          if (c.fleet_status_key === "maintenance" || c.status === "ซ่อมบำรุง" || c.status === "สถานะซ่อมบำรุง") return false;
          if (c.fleet_status_key === "unavailable" || hasOverlapOnSelectedDates) return false;
          if (isTrulyOnRent) {
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            if (searchS <= today && searchE >= today) return false;
          }
        }
      }

      // 5. Sidebar Search keyword (supports plate, brand, model, VIN/chassis, owner, beneficiary, insurance, notes)
      if (kw) {
        const target = `${c.plate || ''} ${c.brand || ''} ${c.model || ''} ${c.car_group || ''} ${c.company || ''} ${c.color || ''} ${c.chassis_no || ''} ${c.ins_company || ''} ${c.owner || ''} ${c.beneficiary || ''} ${c.notes || ''}`.toLowerCase();
        const targetClean = target.replace(/[- ]/g, '');
        const kwClean = kw.replace(/[- ]/g, '');
        if (!target.includes(kw) && !targetClean.includes(kwClean)) return false;
      }

      return true;
    });

    const countTxt = document.getElementById("calc-cars-count");
    if (countTxt) {
      const availCount = filtered.filter(c => {
        if (c.status === "กำลังเช่า" || c.is_on_rent) return false;
        if (c.fleet_status_key === "maintenance" || c.status === "ซ่อมบำรุง" || c.status === "สถานะซ่อมบำรุง") return false;
        return c.fleet_status_key === "available" || c.fleet_status_key === "reserved" || c.status === "ว่างพร้อมใช้งาน";
      }).length;
      countTxt.textContent = isEn
        ? `Available: ${availCount} / ${filtered.length} cars`
        : `ว่างพร้อมใช้งาน: ${availCount} / ${filtered.length} คัน`;
    }

    this.checkFinancePaymentDueAlerts();

    if (filtered.length === 0) {
      container.innerHTML = isEn
        ? `<div style="grid-column:1/-1; text-align:center; padding:40px; color:#64748B;">No vehicles match current filters</div>`
        : `<div style="grid-column:1/-1; text-align:center; padding:40px; color:#64748B;">ไม่พบรถยนต์ตามตัวกรองที่เลือก</div>`;
      return;
    }

    const buildCardHtml = (c, idx) => {
      const isAvail = c.fleet_status_key === "available" || c.fleet_status_key === "reserved";
      const autoType = dur.days >= 30 ? (isEn ? "Monthly" : "รายเดือน") : (dur.days >= 7 ? (isEn ? "Weekly" : "รายสัปดาห์") : (isEn ? "Daily" : "รายวัน"));
      const _rp = this.calculateCarRentalPrice(c, dur.days, autoType) || {};
      const basePrice = Number(_rp.basePrice) || 0;
      const priceDay = Number(_rp.priceDay) || 0;
      const priceWeek = Number(_rp.priceWeek) || 0;
      const priceMonth = Number(_rp.priceMonth) || 0;
      const carImg = (c.image || "").trim();
      const safePlate = String(c.plate || "").replace(/'/g, "\\'");
      const safeId = `${idx}_${String(c.plate || "").replace(/[^a-zA-Z0-9]/g, "_")}`;

      // 1. Car Code & Category Tag (SW001 & NIMBLE)
      const carCode = c.car_code || c.code || `SW${String(idx + 1).padStart(3, '0')}`;
      const rawGrp = String(c.car_group || 'SEDAN').toUpperCase();
      let catTag = rawGrp.replace(/\(.*?\)/g, '').trim();
      if (rawGrp.includes("รถเก๋ง") || catTag.includes("SEDAN")) {
        catTag = (idx % 2 === 0) ? "NIMBLE" : "SEDAN";
      } else if (catTag.includes("SUV")) {
        catTag = (idx % 2 === 0) ? "ASPIRE" : "SUV";
      } else if (catTag.includes("VAN") || rawGrp.includes("ตู้")) {
        catTag = "PRESTIGE";
      } else if (!catTag) {
        catTag = "FLEET";
      }

      const { plateNo, province, isRed } = this.formatPlateDisplay(c.plate);

      // Active Bookings for this specific car
      const normCarPlate = this.normalizePlate(c.plate);
      const cardActiveBookings = (this.bookings || []).filter(b => {
        if (this.normalizePlate(b.car_id) !== normCarPlate) return false;
        const bStat = String(b.status || "").trim();
        return !["เสร็จสิ้น", "ยกเลิก", "Completed", "Canceled", "completed", "canceled"].includes(bStat);
      });
      const hasAnyActiveBooking = cardActiveBookings.length > 0;
      const hasBookingOnRent = cardActiveBookings.some(b => b.status === "กำลังเช่า" || b.status === "รอรับคืน");
      const isTrulyOnRent = hasBookingOnRent || (c.is_on_rent && c.status === "กำลังเช่า");

      // 3. Status Pill
      const l = isEn ? "EN" : "TH";
      const dict = (window.translations && window.translations[l]) ? window.translations[l] : null;
      let statusText = (dict && dict.available) || (isEn ? "Available" : "ว่างพร้อมใช้งาน");
      let statusBg = "#ECFDF5", statusBorder = "#A7F3D0", statusColor = "#065F46", statusDot = "#10B981";

      if (c.fleet_status_key === "maintenance" || c.status === "ซ่อมบำรุง" || c.status === "สถานะซ่อมบำรุง") {
        statusText = (dict && dict.workshop) || (isEn ? "Workshop" : "ซ่อมบำรุง");
        statusBg = "#FFF7ED"; statusBorder = "#FED7AA"; statusColor = "#9A3412"; statusDot = "#F97316";
      } else if (isTrulyOnRent) {
        statusText = (dict && dict.on_rent) || (isEn ? "On rent" : "กำลังเช่า");
        statusBg = "#EFF6FF"; statusBorder = "#BFDBFE"; statusColor = "#1E40AF"; statusDot = "#3B82F6";
      } else if (c.status === "ติดจอง" || c.fleet_status_key === "reserved" || c.fleet_status_key === "unavailable" || hasAnyActiveBooking) {
        // Booked (deposit stage / awaiting hand-over) -> STRICTLY "Reserved / ติดจอง", never "On rent"
        statusText = (dict && dict.reserved) || (isEn ? "Reserved" : "ติดจอง");
        statusBg = "#FEFCE8"; statusBorder = "#FEF08A"; statusColor = "#A16207"; statusDot = "#F59E0B";
      }

      // 4. Expiry Alert Pills (Insurance, PRB, Tax)
      const alerts = this.getCarExpiryAlerts(c, l);
      const alertPillHtml = (alerts && alerts.length > 0)
        ? alerts.map(a => `
            <span class="car-pill" style="background:${a.bg}; border:1px solid ${a.border}; color:${a.color};">
              <span class="car-pill-dot" style="background:${a.dot};"></span> ${a.text}
            </span>
          `).join("")
        : "";

      const fuelLabel = String(c.fuel_type || '').trim() || (isEn ? 'Petrol' : 'เบนซิน');
      const carSpecsSub = `${c.reg_year || c.year || '2024'} · ${String(c.color || 'WHITE').toUpperCase()} · ${fuelLabel}`;
      const dailyRateLabel = (dict && dict.daily_rate) || (isEn ? 'Daily Rate' : 'ค่าเช่ารายวัน');
      const detailsLabel = (dict && dict.details) || (isEn ? 'Details' : 'ดูรายละเอียด');
      const bookNowLabel = isAvail
        ? ((dict && dict.book_now) || (isEn ? 'Book Now' : 'จองรถ'))
        : ((dict && dict.queue) || (isEn ? 'Queue' : 'จองคิว'));
      const bookTitle = !isAvail
        ? (isEn ? "Reserved - click to reserve queue" : "ติดจอง - คลิกเพื่อจองคิวต่อ")
        : bookNowLabel;
      const durLabel = dur.days > 0
        ? (isEn ? `${dur.days}d ฿${basePrice.toLocaleString()}` : `${dur.days} วัน ฿${basePrice.toLocaleString()}`)
        : "";
      const eyeIcon = `<svg class="car-plate-eye" viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>`;
      const plateInner = isRed
        ? `<div class="thai-plate-text"><div class="thai-plate-num">${isEn ? "Red Plate" : "ป้ายแดง"}</div><div class="thai-plate-prov">${isEn ? "Red plate" : "ป้ายแดง"}</div></div>`
        : `<div class="thai-plate-text"><div class="thai-plate-num">${plateNo}</div><div class="thai-plate-prov">${province}</div></div>`;
      const plateHtml = `<div class="thai-plate-badge${isRed ? " red-plate" : ""}" id="plate-badge-${safeId}" role="button" tabindex="0" title="${detailsLabel}" onclick="app.openCarDetailsModal('${safePlate}')">${eyeIcon}${plateInner}</div>`;

      return `
        <div class="car-card-modern">
          <div class="car-top-row">
            <div class="car-code-group">
              <button type="button" class="car-code-book" title="${bookTitle}" onclick="app.openBookModal('${safePlate}')">
                <span class="car-code-title">${carCode}</span>
                <svg class="car-code-book-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>
              </button>
              <!-- <div class="car-cat-subtag">${catTag}</div> -->
            </div>
            ${plateHtml}
          </div>

          <div class="car-model-title">${c.brand || ''} ${c.model || ''}</div>
          <div class="car-specs-subtitle">${carSpecsSub}</div>

          <div class="car-pills-row">
            <span class="car-pill" style="background:${statusBg}; border:1px solid ${statusBorder}; color:${statusColor}; cursor:pointer;" onclick="app.openCarScheduleModal('${safePlate}')" title="${isEn ? 'Click to view vehicle schedule & queue' : 'คลิกเพื่อดูปฏิทินคิวงานของรถคันนี้'}">
              <span class="car-pill-dot" style="background:${statusDot};"></span> ${statusText}
            </span>
            ${alertPillHtml}
            <span class="car-rate-chip" title="${dailyRateLabel}">
              <b>฿${priceDay.toLocaleString()}</b>${durLabel ? `<span>${durLabel}</span>` : ""}
            </span>
          </div>
        </div>
      `;
    };

    container.innerHTML = filtered.map((c, idx) => {
      try {
        return buildCardHtml(c, idx);
      } catch (err) {
        console.error("renderFleetCards: card build failed", c && c.plate, err);
        const sp = String((c && c.plate) || "").replace(/'/g, "\\'");
        const cCode = (c && (c.car_code || c.code)) || `SW${String(idx + 1).padStart(3, '0')}`;
        const cCat = String((c && c.car_group) || 'SEDAN').toUpperCase().replace(/\(.*?\)/g, '').trim() || 'FLEET';
        const pDay = Number(c && (c.daily_rate || c.price_per_day || c.rental_rate || 1000)) || 1000;
        const cStat = String((c && c.status) || 'ว่างพร้อมใช้งาน');
        return `
        <div class="car-card-modern">
          <div class="car-top-row">
            <div class="car-code-group">
              <button type="button" class="car-code-book" title="${isEn ? 'Book Now' : 'จองรถ'}" onclick="app.openBookModal('${sp}')">
                <span class="car-code-title">${cCode}</span>
                <svg class="car-code-book-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>
              </button>
              <!-- <div class="car-cat-subtag">${cCat}</div> -->
            </div>
            <div class="thai-plate-badge" role="button" title="${isEn ? 'Details' : 'ดูรายละเอียด'}" onclick="app.openCarDetailsModal('${sp}')">
              <div class="thai-plate-text"><div class="thai-plate-num">${(c && c.plate) || ''}</div><div class="thai-plate-prov">${(c && c.province) || 'กรุงเทพมหานคร'}</div></div>
            </div>
          </div>
          <div class="car-model-title">${(c && c.brand) || ''} ${(c && c.model) || ''}</div>
          <div class="car-specs-subtitle">${(c && c.year) || '2024'} · ${String((c && c.color) || 'WHITE').toUpperCase()} · ${(c && c.fuel_type) || 'เบนซิน'}</div>
          <div class="car-pills-row">
            <span class="car-pill" style="background:#ECFDF5; border:1px solid #A7F3D0; color:#065F46; cursor:pointer;" onclick="app.openCarScheduleModal('${sp}')" title="คลิกเพื่อดูปฏิทินคิวงาน">
              <span class="car-pill-dot" style="background:#10B981;"></span> ${cStat}
            </span>
            <span class="car-rate-chip">
              <b>฿${pDay.toLocaleString()}</b>
            </span>
          </div>
        </div>`;
      }
    }).join("");
  },

  setSelectedVehicle(vehicle) {
    this.selectedVehicle = vehicle || null;
  },

  setIsModalOpen(isOpen) {
    this.isModalOpen = Boolean(isOpen);
    const m = document.getElementById("modal-car-details");
    if (m) {
      if (this.isModalOpen) {
        this.modalZIndex = (this.modalZIndex || 2000) + 10;
        m.style.zIndex = String(this.modalZIndex);
        m.classList.add("open");
      } else {
        m.classList.remove("open");
      }
    }
  },

  closeCarDetailsModal() {
    this.setIsModalOpen(false);
    this.setSelectedVehicle(null);
  },

  convertDriveUrl(url) {
    if (!url || typeof url !== "string") return "";
    const u = url.trim();
    if (!u || u === "-" || u === "null" || u === "undefined") return "";
    const m1 = u.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
    if (m1) return `https://lh3.googleusercontent.com/d/${m1[1]}`;
    const m2 = u.match(/[?&]id=([a-zA-Z0-9_-]+)/);
    if (m2) return `https://lh3.googleusercontent.com/d/${m2[1]}`;
    return u;
  },

  openCarDetailsModal(plateOrEl) {
    const isEn = (this.currentLang === "EN");
    let plate = plateOrEl;
    if (plateOrEl && typeof plateOrEl === "object" && plateOrEl.getAttribute) {
      plate = plateOrEl.getAttribute("data-plate") || plateOrEl.dataset?.plate;
    }
    const cleanPlate = String(plate || "").trim();
    const car = (this.cars || []).find(c => c.plate === cleanPlate)
      || (this.cars || []).find(c => String(c.plate).trim() === cleanPlate)
      || (this.cars || []).find(c => this.normalizePlate(c.plate) === this.normalizePlate(cleanPlate));

    if (!car) {
      this.showToast(isEn ? "Vehicle not found" : "ไม่พบข้อมูลรถยนต์", "danger");
      return;
    }

    // 1. Update State (Mission 1)
    this.setSelectedVehicle(car);
    this.setIsModalOpen(true);

    const c = this.selectedVehicle;
    const safePlate = String(c.plate || "").replace(/'/g, "\\'");
    const rates = this.getCarRates(c);
    const dur = this.calcDuration ? this.calcDuration() : { days: 1, hours: 0, text: "1 วัน" };
    const priceDay = rates.priceDay || rates.day || 1000;
    const priceWeek = rates.priceWeek || rates.week || 6000;
    const priceMonth = rates.priceMonth || rates.month || 20000;
    const autoType = dur.days >= 30 ? (isEn ? "Monthly" : "รายเดือน") : (dur.days >= 7 ? (isEn ? "Weekly" : "รายสัปดาห์") : (isEn ? "Daily" : "รายวัน"));

    let totalPrice = priceDay * Math.max(1, dur.days || 1);
    try {
      if (typeof this.calculateCarRentalPrice === "function") {
        const calc = this.calculateCarRentalPrice(c, dur.days, autoType);
        if (calc && typeof calc.basePrice === "number") {
          totalPrice = calc.basePrice;
        }
      }
    } catch (e) {
      console.warn("Pricing calculation error in modal:", e);
    }

    const isAvail = (c.status === "ว่างพร้อมใช้งาน" || c.fleet_status_key === "available");
    const carImg = c.image && c.image !== "-" ? c.image : "";

    const prbVal = (c.prb_price !== undefined && c.prb_price !== null && c.prb_price !== '' && Number(c.prb_price) > 0)
      ? Number(c.prb_price)
      : ((c.act_price !== undefined && c.act_price !== null && c.act_price !== '' && Number(c.act_price) > 0) ? Number(c.act_price) : null);
    const prbFormatted = (prbVal !== null && !isNaN(prbVal) && prbVal > 0)
      ? '฿' + prbVal.toLocaleString(undefined, {minimumFractionDigits: (prbVal % 1 === 0 ? 0 : 2), maximumFractionDigits: 2})
      : '-';

    const insVal = (c.insurance_premium !== undefined && c.insurance_premium !== null && c.insurance_premium !== '' && Number(c.insurance_premium) > 0)
      ? Number(c.insurance_premium)
      : ((c.ins_premium !== undefined && c.ins_premium !== null && c.ins_premium !== '' && Number(c.ins_premium) > 0) ? Number(c.ins_premium) : null);
    const insFormatted = (insVal !== null && !isNaN(insVal) && insVal > 0)
      ? '฿' + insVal.toLocaleString(undefined, {minimumFractionDigits: (insVal % 1 === 0 ? 0 : 2), maximumFractionDigits: 2})
      : '-';

    const coverageVal = (c.ins_coverage_amount !== undefined && c.ins_coverage_amount !== null && c.ins_coverage_amount !== '' && Number(c.ins_coverage_amount) > 0)
      ? Number(c.ins_coverage_amount)
      : null;
    const coverageFormatted = (coverageVal !== null && !isNaN(coverageVal) && coverageVal > 0)
      ? '฿' + coverageVal.toLocaleString(undefined, {minimumFractionDigits: (coverageVal % 1 === 0 ? 0 : 2), maximumFractionDigits: 2})
      : '-';

    const insPolicyDisplay = (c.ins_policy_no && c.ins_policy_no !== '-') ? c.ins_policy_no : ((c.insurance_policy_no && c.insurance_policy_no !== '-') ? c.insurance_policy_no : (c.policy_no && c.policy_no !== '-' ? c.policy_no : '-'));
    const actPolicyDisplay = (c.act_policy_no && c.act_policy_no !== '-') ? c.act_policy_no : '-';
    const actCompanyDisplay = (c.act_company && c.act_company !== '-') ? c.act_company : '-';

    const regYearDisplay = (c.register_year && c.register_year !== '-') ? c.register_year : (c.reg_year || '-');
    const insCompanyDisplay = (c.insurance_company && c.insurance_company !== '-') ? c.insurance_company : (c.ins_company || c.insurance_brand || '-');
    const financeCompanyDisplay = (c.finance_company && c.finance_company !== '-') ? c.finance_company : (c.is_debt_free ? (isEn ? 'Debt Free' : 'ปลอดภาระ') : '-');
    const nextServiceMil = (c.next_service_mileage !== undefined && c.next_service_mileage !== null && Number(c.next_service_mileage) > 0)
      ? Number(c.next_service_mileage)
      : ((c.next_engine_oil_mileage && Number(c.next_engine_oil_mileage) > 0) ? Number(c.next_engine_oil_mileage) : null);
    const nextServiceMilFormatted = (nextServiceMil !== null && !isNaN(nextServiceMil) && nextServiceMil > 0) ? nextServiceMil.toLocaleString() + ' km' : '-';

    const titleEl = document.getElementById("modal-car-details-title");
    if (titleEl) {
      titleEl.textContent = `${c.brand || ''} ${c.model || ''}`;
    }

    const plateBadge = document.getElementById("car-details-plate-badge");
    if (plateBadge) {
      plateBadge.innerHTML = `
        <span style="display:inline-block; border:1.5px solid #1E293B; border-radius:4px; padding:2px 8px; font-size:12px; font-weight:800; background:#FFF; color:#1E293B; letter-spacing:0.5px;">
          ${c.plate}
        </span>
      `;
    }

    const statusBadge = document.getElementById("car-details-status-badge");
    if (statusBadge) {
      let statusBg = "#DCFCE7", statusColor = "#166534", statusBorder = "#86EFAC";
      if (c.status === "ซ่อมบำรุง") {
        statusBg = "#FEE2E2"; statusColor = "#991B1B"; statusBorder = "#FCA5A5";
      } else if (c.status === "ติดจอง" || c.status === "เตรียมส่งมอบ") {
        statusBg = "#FFF7ED"; statusColor = "#9A3412"; statusBorder = "#FED7AA";
      } else if (c.status === "กำลังเช่า") {
        statusBg = "#EFF6FF"; statusColor = "#1E40AF"; statusBorder = "#BFDBFE";
      }
      statusBadge.innerHTML = `
        <span style="display:inline-block; background:${statusBg}; color:${statusColor}; border:1px solid ${statusBorder}; border-radius:12px; padding:2px 10px; font-size:11.5px; font-weight:700;">
          ${c.status || "ว่างพร้อมใช้งาน"}
        </span>
      `;
    }

    const bodyEl = document.getElementById("car-details-modal-body");
    if (!bodyEl) return;

    bodyEl.innerHTML = `
      <!-- Top Row: Photo & Pricing Summary -->
      <div style="display:grid; grid-template-columns: 1fr 1fr; gap:16px; margin-bottom:16px;">
        <!-- Photo Box: 4-Angle Images Grid (TARGET MISSION 2) -->
        <div style="position:relative; border-radius:10px; overflow:hidden; border:1px solid #E2E8F0; background:#0F172A; min-height:190px; padding:6px; display:flex; flex-direction:column; justify-content:center;">
          <div style="display:grid; grid-template-columns: 1fr 1fr; gap:6px; height:100%;">
            ${[
              { key: "front", label: isEn ? "Front" : "ด้านหน้า", url: c.img_front || (!c.img_left && !c.img_rear && !c.img_right ? carImg : "") },
              { key: "left", label: isEn ? "Left" : "ด้านซ้าย", url: c.img_left },
              { key: "rear", label: isEn ? "Rear" : "ด้านหลัง", url: c.img_rear },
              { key: "right", label: isEn ? "Right" : "ด้านขวา", url: c.img_right }
            ].map(angle => {
              const directSrc = this.convertDriveUrl(angle.url);
              return `
                <div style="position:relative; background:#1E293B; border-radius:6px; overflow:hidden; border:1px solid #334155; height:88px; display:flex; align-items:center; justify-content:center;">
                  <span style="position:absolute; top:3px; left:4px; background:rgba(15,23,42,0.85); color:#F8FAFC; font-size:9.5px; font-weight:700; padding:1px 5px; border-radius:3px; z-index:2; border:1px solid rgba(255,255,255,0.15);">
                    ${angle.label}
                  </span>
                  ${directSrc ? `
                    <img src="${directSrc}" alt="${angle.label}" onclick="window.open('${angle.url || directSrc}', '_blank')" style="width:100%; height:100%; object-fit:cover; cursor:pointer;" title="${isEn ? 'Click to open image in new tab' : 'คลิกเพื่อดูรูปขนาดเต็มในแท็บใหม่'}">
                  ` : `
                    <div style="color:#64748B; font-size:10.5px; font-weight:600; text-align:center; padding:4px;">
                      ${isEn ? 'No Photo' : 'ยังไม่มีรูป'}
                    </div>
                  `}
                </div>
              `;
            }).join("")}
          </div>
          <button type="button" onclick="app.closeModal('modal-car-details'); app.openEditCarModal('${safePlate}')" class="btn btn-sm" style="position:absolute; bottom:10px; right:10px; background:rgba(255,255,255,0.92); border:1px solid #CBD5E1; border-radius:16px; padding:3px 10px; font-size:11px; font-weight:700; cursor:pointer; box-shadow:0 2px 4px rgba(0,0,0,0.2); z-index:3;">
            📷 ${isEn ? 'Edit 4-Angle Photos' : 'ใส่รูปรถ 4 มุม'}
          </button>
        </div>

        <!-- Pricing Rates Card -->
        <div style="background:#FAF7F2; border:1px solid #FED7AA; border-radius:10px; padding:14px; display:flex; flex-direction:column; justify-content:space-between;">
          <div>
            <div style="font-size:12px; font-weight:700; color:#C2410C; margin-bottom:8px; text-transform:uppercase; letter-spacing:0.5px;">
              ${isEn ? 'Rental Pricing Rates' : 'อัตราค่าเช่า'}
            </div>
            <div style="display:grid; grid-template-columns: repeat(3, 1fr); gap:8px; margin-bottom:12px; background:#FFF; border:1px solid #E2E8F0; border-radius:8px; padding:8px; text-align:center;">
              <div>
                <div style="font-size:10.5px; color:#64748B;">${isEn ? 'Daily' : 'รายวัน'}</div>
                <div style="font-weight:800; font-size:13px; color:#1E293B;">฿${priceDay.toLocaleString()}</div>
              </div>
              <div>
                <div style="font-size:10.5px; color:#64748B;">${isEn ? 'Weekly' : 'รายสัปดาห์'}</div>
                <div style="font-weight:800; font-size:13px; color:#1E293B;">฿${priceWeek.toLocaleString()}</div>
              </div>
              <div>
                <div style="font-size:10.5px; color:#64748B;">${isEn ? 'Monthly' : 'รายเดือน'}</div>
                <div style="font-weight:800; font-size:13px; color:#1E293B;">฿${priceMonth.toLocaleString()}</div>
              </div>
            </div>
          </div>

          <div style="background:#FFF7ED; border:1px solid #FDBA74; border-radius:8px; padding:10px; display:flex; justify-content:space-between; align-items:center;">
            <div>
              <div style="font-size:11px; color:#9A3412; font-weight:600;">${isEn ? `Calculated (${dur.days || 1}d ${dur.hours || 0}h)` : `คำนวณตามระยะเวลา (${dur.days || 1} วัน ${dur.hours || 0} ชม.)`}</div>
              <div style="font-size:10.5px; color:#64748B;">${isEn ? 'Based on active dates filter' : 'ตามช่วงเวลาเช่าที่เลือกด้านบน'}</div>
            </div>
            <div style="font-size:18px; font-weight:800; color:#EA580C;">
              ฿${totalPrice.toLocaleString()}
            </div>
          </div>
        </div>
      </div>

      <!-- Mid Grid: Specifications & Detailed Records (Swapped top-right and bottom-right cards) -->
      <div style="display:grid; grid-template-columns: 1fr 1fr; gap:12px; margin-bottom:16px;">
        <!-- Top-Left: ข้อมูลตัวรถเชิงลึก -->
        <div style="background:#F8FAFC; border:1px solid #E2E8F0; border-radius:8px; padding:12px;">
          <div style="font-size:12px; font-weight:700; color:#334155; margin-bottom:8px; display:flex; align-items:center; gap:6px;">
            <span>${isEn ? 'Vehicle Specifications' : 'ข้อมูลตัวรถเชิงลึก'}</span>
          </div>
          <div style="display:grid; grid-template-columns: 1fr 1fr; gap:6px; font-size:11.5px;">
            <div><b style="color:#64748B;">${isEn ? 'Group:' : 'กลุ่มรถ:'}</b> ${c.car_group || '-'}</div>
            <div><b style="color:#64748B;">${isEn ? 'Reg Year:' : 'ปีจดทะเบียน:'}</b> ${regYearDisplay}</div>
            <div><b style="color:#64748B;">${isEn ? 'Color:' : 'สีตัวถัง:'}</b> ${c.color || '-'}</div>
            <div><b style="color:#64748B;">${isEn ? 'Fuel:' : 'เชื้อเพลิง:'}</b> ${c.fuel_type || c.fuel_system || '-'}</div>
            <div><b style="color:#64748B;">${isEn ? 'Engine CC:' : 'ขนาด CC:'}</b> ${c.engine_cc || c.cc_ev || '-'}</div>
            <div><b style="color:#64748B;">${isEn ? 'Mileage:' : 'เลขไมล์:'}</b> ${Number(String(c.mileage || '0').replace(/,/g, '')).toLocaleString()} km</div>
            <div><b style="color:#64748B;">${isEn ? 'VIN (Chassis):' : 'เลขตัวถัง:'}</b> <code>${c.chassis_no || c.vin || '-'}</code></div>
            <div><b style="color:#64748B;">${isEn ? 'Engine No:' : 'เลขเครื่องยนต์:'}</b> <code>${c.engine_no || '-'}</code></div>
            <div><b style="color:#64748B;">${isEn ? 'Owner:' : 'เจ้าของรถ:'}</b> ${c.car_owner || c.owner || c.owner_name || '-'}</div>
            <div><b style="color:#64748B;">${isEn ? 'Beneficiary:' : 'ผู้รับผลประโยชน์:'}</b> ${c.beneficiary || '-'}</div>
            <div style="grid-column: span 2;"><b style="color:#64748B;">${isEn ? 'Possessor / Company:' : 'ผู้ถือกรรมสิทธิ์:'}</b> ${c.company || c.owner_company || '-'}</div>
          </div>
        </div>

        <!-- Top-Right: กำหนดเช็คระยะ & การเงิน (Moved from bottom-right) -->
        <div style="background:#F8FAFC; border:1px solid #E2E8F0; border-radius:8px; padding:12px;">
          <div style="font-size:12px; font-weight:700; color:#334155; margin-bottom:8px; display:flex; align-items:center; gap:6px;">
            <span>${isEn ? 'Service Due & Financing' : 'กำหนดเช็คระยะ & การเงิน'}</span>
          </div>
          <div style="display:grid; grid-template-columns: 1fr 1fr; gap:6px; font-size:11.5px;">
            <div><b style="color:#64748B;">${isEn ? 'Last Service:' : 'เช็คล่าสุด:'}</b> ${c.last_service_date || '-'}</div>
            <div><b style="color:#64748B;">${isEn ? 'Next Service Date:' : 'เช็คถัดไป (วันที่):'}</b> <span style="font-weight:700; color:#0369A1;">${c.next_service_date || c.next_engine_oil_date || c.next_service || '-'}</span></div>
            <div><b style="color:#64748B;">${isEn ? 'Next Mileage:' : 'เช็คถัดไป (ไมล์):'}</b> <span style="font-weight:700; color:#0369A1;">${nextServiceMilFormatted}</span></div>
            <div><b style="color:#64748B;">${isEn ? 'Finance Co:' : 'บริษัทไฟแนนซ์:'}</b> ${financeCompanyDisplay}</div>
            <div><b style="color:#64748B;">${isEn ? 'Installment/Mo:' : 'ค่างวด/เดือน:'}</b> ${(c.installment_amount || c.hp_installment) ? Number(c.installment_amount || c.hp_installment).toLocaleString() + ' ฿' : '-'}</div>
            <div><b style="color:#64748B;">${isEn ? 'Due Date:' : 'วันตัดงวด:'}</b> ${c.payment_due_date || '-'}</div>
          </div>
        </div>

        <!-- Bottom-Left: ข้อมูลกรมธรรม์ประกันภัย -->
        <div style="background:#F8FAFC; border:1px solid #E2E8F0; border-radius:8px; padding:12px;">
          <div style="font-size:12px; font-weight:700; color:#334155; margin-bottom:8px; display:flex; align-items:center; gap:6px;">
            <span>🛡️</span>
            <span>${isEn ? 'Comprehensive Insurance Policy' : 'ข้อมูลกรมธรรม์ประกันภัย'}</span>
          </div>
          <div style="display:grid; grid-template-columns: 1fr 1fr; gap:6px; font-size:11.5px;">
            <div><b style="color:#64748B;">${isEn ? 'Company:' : 'บริษัทประกัน:'}</b> ${insCompanyDisplay}</div>
            <div><b style="color:#64748B;">${isEn ? 'Policy No:' : 'เลขกรมธรรม์:'}</b> <code style="font-size:11px;">${insPolicyDisplay}</code></div>
            <div><b style="color:#64748B;">${isEn ? 'Class:' : 'ชั้นความคุ้มครอง:'}</b> <span style="font-weight:700; color:#0369A1;">${c.ins_class || '-'}</span></div>
            <div><b style="color:#64748B;">${isEn ? 'Category:' : 'หมวดประกัน:'}</b> ${c.ins_category || '-'}</div>
            <div><b style="color:#64748B;">${isEn ? 'Coverage Amount:' : 'ทุนประกัน:'}</b> <span style="font-weight:700; color:#059669;">${coverageFormatted}</span></div>
            <div><b style="color:#64748B;">${isEn ? 'Type:' : 'ประเภทประกัน:'}</b> ${c.ins_type || '-'}</div>
            <div><b style="color:#64748B;">${isEn ? 'Expiry:' : 'วันหมดอายุ:'}</b> <span style="color:#DC2626; font-weight:700;">${c.ins_expiry || c.insurance_expire_date || '-'}</span></div>
            <div><b style="color:#64748B;">${isEn ? 'Premium:' : 'เบี้ยประกัน:'}</b> <span style="font-weight:700; color:#0F172A;">${insFormatted}</span></div>
            <div style="grid-column: span 2; margin-top:4px;">
              ${c.ins_doc_url ? `
                <a href="${c.ins_doc_url}" target="_blank" rel="noopener noreferrer" class="btn btn-sm" style="display:inline-flex; align-items:center; gap:6px; background:#EFF6FF; border:1.5px solid #3B82F6; color:#1D4ED8; font-weight:700; font-size:11.5px; padding:4px 10px; border-radius:6px; text-decoration:none;">
                  📄 ${isEn ? 'View Insurance Policy (Drive)' : 'ดูรูป/เอกสารกรมธรรม์ (Drive) ↗'}
                </a>
              ` : `
                <span style="font-size:11px; color:#94A3B8;">${isEn ? 'No policy document attached' : 'ยังไม่มีลิงก์เอกสารกรมธรรม์'}</span>
              `}
            </div>
          </div>
        </div>

        <!-- Bottom-Right: ข้อมูล พ.ร.บ. และภาษี -->
        <div style="background:#F8FAFC; border:1px solid #E2E8F0; border-radius:8px; padding:12px;">
          <div style="font-size:12px; font-weight:700; color:#334155; margin-bottom:8px; display:flex; align-items:center; gap:6px;">
            <span>📄</span>
            <span>${isEn ? 'ACT & Tax Registration' : 'ข้อมูล พ.ร.บ. และภาษี'}</span>
          </div>
          <div style="display:grid; grid-template-columns: 1fr 1fr; gap:6px; font-size:11.5px;">
            <div><b style="color:#64748B;">${isEn ? 'ACT Company:' : 'บริษัท พ.ร.บ.:'}</b> ${actCompanyDisplay}</div>
            <div><b style="color:#64748B;">${isEn ? 'ACT Policy No:' : 'เลข พ.ร.บ.:'}</b> <code style="font-size:11px;">${actPolicyDisplay}</code></div>
            <div><b style="color:#64748B;">${isEn ? 'ACT Expiry:' : 'หมดอายุ พ.ร.บ.:'}</b> <span style="color:#DC2626; font-weight:700;">${c.act_expiry || c.prb_expire_date || '-'}</span></div>
            <div><b style="color:#64748B;">${isEn ? 'Tax Expiry:' : 'หมดอายุภาษี:'}</b> <span style="color:#DC2626; font-weight:700;">${c.tax_expiry || c.tax_expire_date || '-'}</span></div>
            <div style="grid-column: span 2;"><b style="color:#64748B;">${isEn ? 'PRB Price:' : 'ราคา พ.ร.บ.:'}</b> <span style="font-weight:700; color:#0F172A;">${prbFormatted}</span></div>
          </div>
        </div>
      </div>

      <!-- Notes if any -->
      ${c.notes ? `
        <div style="background:#FFFBEB; border:1px solid #FDE68A; border-radius:8px; padding:10px 14px; margin-bottom:16px; font-size:12px; color:#92400E;">
          <b>${isEn ? 'Notes / Remarks:' : 'หมายเหตุ:'}</b> ${c.notes}
        </div>
      ` : ''}

      <!-- Insurance Policy & Renewal History (TARGET MISSION 3: Strict Separation) -->
      <div style="background:#FFFFFF; border:1.5px solid #CBD5E1; border-radius:10px; padding:14px; margin-bottom:16px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; flex-wrap:wrap; gap:8px;">
          <div style="font-size:13px; font-weight:800; color:#1E293B; display:flex; align-items:center; gap:6px;">
            <span>🛡️</span>
            <span>${isEn ? 'Insurance Policy & Renewal History' : 'ประวัติกรมธรรม์ & การต่ออายุย้อนหลัง'}</span>
          </div>
          <span style="font-size:11px; color:#64748B; font-weight:600;">
            ${isEn ? 'Separated from maintenance logs' : 'แยกจากประวัติซ่อมบำรุง'}
          </span>
        </div>

        <div class="table-responsive" style="max-height:160px; overflow-y:auto; border:1px solid #E2E8F0; border-radius:6px;">
          <table class="custom-table" style="margin:0; font-size:11.5px;">
            <thead style="position:sticky; top:0; background:#F8FAFC; z-index:1;">
              <tr>
                <th style="padding:6px 8px;">${isEn ? 'Expiry Date' : 'วันหมดอายุ'}</th>
                <th style="padding:6px 8px;">${isEn ? 'Company / Type' : 'บริษัท / ประเภท'}</th>
                <th style="padding:6px 8px;">${isEn ? 'Policy No' : 'เลขกรมธรรม์'}</th>
                <th style="padding:6px 8px; text-align:right;">${isEn ? 'Premium (฿)' : 'เบี้ยประกัน (฿)'}</th>
                <th style="padding:6px 8px; text-align:center;">${isEn ? 'Document' : 'เอกสาร'}</th>
              </tr>
            </thead>
            <tbody id="car-details-ins-tbody">
              <tr>
                <td colspan="5" style="text-align:center; color:#94A3B8; padding:12px;">${isEn ? 'Loading insurance records...' : 'กำลังโหลดประวัติกรมธรรม์...'}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>


      <!-- Maintenance Tracker & ROI Section (MISSION 2) -->
      <div style="background:#FFFFFF; border:1.5px solid #CBD5E1; border-radius:10px; padding:14px; margin-bottom:16px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; flex-wrap:wrap; gap:8px;">
          <div style="font-size:13px; font-weight:800; color:#1E293B; display:flex; align-items:center; gap:6px;">
            <span>🔧</span>
            <span>${isEn ? 'Maintenance History & Vehicle ROI' : 'ประวัติซ่อมบำรุง & วิเคราะห์กำไรสุทธิ (ROI)'}</span>
          </div>
          <span id="car-roi-badge" style="font-size:12px; font-weight:700; padding:3px 10px; border-radius:12px; background:#F1F5F9; color:#475569;">
            ${isEn ? 'Calculating...' : 'กำลังคำนวณ...'}
          </span>
        </div>

        <!-- 3 ROI KPI Cards -->
        <div style="display:grid; grid-template-columns: repeat(3, 1fr); gap:10px; margin-bottom:12px; text-align:center;">
          <div style="background:#F0FDF4; border:1px solid #BBF7D0; border-radius:8px; padding:8px;">
            <div style="font-size:10.5px; color:#15803D; font-weight:700;">${isEn ? 'Total Revenue' : 'รายได้รวมสะสม'}</div>
            <div id="car-roi-income" style="font-size:14px; font-weight:800; color:#16A34A; margin-top:2px;">฿0.00</div>
          </div>
          <div style="background:#FFF1F2; border:1px solid #FECDD3; border-radius:8px; padding:8px;">
            <div style="font-size:10.5px; color:#BE123C; font-weight:700;">${isEn ? 'Total Maintenance Cost' : 'ค่าซ่อมบำรุงสะสม'}</div>
            <div id="car-roi-cost" style="font-size:14px; font-weight:800; color:#E11D48; margin-top:2px;">฿0.00</div>
          </div>
          <div id="car-roi-profit-card" style="background:#F8FAFC; border:1px solid #E2E8F0; border-radius:8px; padding:8px;">
            <div style="font-size:10.5px; color:#475569; font-weight:700;">${isEn ? 'Net Profit / ROI' : 'กำไรสุทธิ (ROI)'}</div>
            <div id="car-roi-profit" style="font-size:14px; font-weight:800; color:#0F172A; margin-top:2px;">฿0.00</div>
          </div>
        </div>

        <!-- Add Maintenance Form -->
        <div style="background:#F8FAFC; border:1px solid #E2E8F0; border-radius:8px; padding:10px; margin-bottom:10px;">
          <div style="font-size:11.5px; font-weight:700; color:#334155; margin-bottom:6px;">
            ${isEn ? '+ Record New Maintenance Entry' : '➕ บันทึกรายการซ่อมบำรุงใหม่'}
          </div>
          <div style="display:grid; grid-template-columns: 140px 1fr 120px auto; gap:8px; align-items:center;">
            <input type="date" id="maint-input-date" class="form-control" style="font-size:11.5px; padding:5px 8px;" value="${new Date().toISOString().split('T')[0]}">
            <input type="text" id="maint-input-desc" class="form-control" style="font-size:11.5px; padding:5px 8px;" placeholder="${isEn ? 'Description (e.g. Oil change, brakes)' : 'รายการซ่อม (เช่น ถ่ายน้ำมันเครื่อง, ผ้าเบรก, ยาง)'}">
            <input type="number" id="maint-input-cost" class="form-control" style="font-size:11.5px; padding:5px 8px;" placeholder="${isEn ? 'Cost (฿)' : 'ค่าใช้จ่าย (฿)'}" min="0" step="any">
            <button type="button" onclick="app.submitCarMaintenance('${safePlate}')" class="btn btn-sm btn-primary" style="font-size:11.5px; padding:6px 14px; white-space:nowrap;">
              ${isEn ? 'Save' : 'บันทึก'}
            </button>
          </div>
        </div>

        <!-- Maintenance History Table -->
        <div class="table-responsive" style="max-height:160px; overflow-y:auto; border:1px solid #E2E8F0; border-radius:6px;">
          <table class="custom-table" style="margin:0; font-size:11.5px;">
            <thead style="position:sticky; top:0; background:#F1F5F9; z-index:1;">
              <tr>
                <th style="padding:6px 8px;">${isEn ? 'Date' : 'วันที่'}</th>
                <th style="padding:6px 8px;">${isEn ? 'Description' : 'รายการซ่อมบำรุง'}</th>
                <th style="padding:6px 8px; text-align:right;">${isEn ? 'Cost (฿)' : 'ค่าใช้จ่าย (฿)'}</th>
                <th style="padding:6px 8px; text-align:center; width:50px;">${isEn ? 'Action' : 'จัดการ'}</th>
              </tr>
            </thead>
            <tbody id="car-details-maint-tbody">
              <tr>
                <td colspan="4" style="text-align:center; color:#94A3B8; padding:12px;">${isEn ? 'Loading maintenance records...' : 'กำลังโหลดประวัติซ่อมบำรุง...'}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Bottom Actions Bar -->
      <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; padding-top:12px; border-top:1px solid #E2E8F0; flex-wrap:wrap;">
        <div style="display:flex; gap:8px; flex-wrap:wrap;">
          <button type="button" onclick="app.closeModal('modal-car-details'); app.openEditCarModal('${safePlate}')" class="btn btn-secondary" style="font-size:12px; padding:7px 12px; border-radius:6px; cursor:pointer;">
            ${isEn ? 'Edit Details' : 'แก้ไขข้อมูล'}
          </button>
          <button type="button" onclick="app.closeModal('modal-car-details'); app.openNewMaintenanceModal('${safePlate}')" class="btn btn-secondary" style="font-size:12px; padding:7px 12px; border-radius:6px; background:#FFF7ED; color:#C2410C; border-color:#FDBA74; cursor:pointer;">
            ${isEn ? 'Maintenance Order' : 'เปิดใบงานซ่อมบำรุง'}
          </button>
          <button type="button" onclick="app.closeModal('modal-car-details'); app.deleteCarByPlate('${safePlate}')" class="btn btn-danger" style="font-size:12px; padding:7px 12px; border-radius:6px; cursor:pointer;">
            ${isEn ? 'Delete Car' : 'ลบรายการรถ'}
          </button>
        </div>

        <div style="display:flex; gap:8px;">
          <button type="button" onclick="app.closeModal('modal-car-details')" class="btn btn-secondary" style="font-size:12px; padding:7px 14px; border-radius:6px; cursor:pointer;">
            ${isEn ? 'Close' : 'ปิด'}
          </button>
        </div>
      </div>
    `;

    this.openModal("modal-car-details");
    this.loadCarMaintenances(cleanPlate);
    this.loadCarInsuranceRecords(cleanPlate);
  },

  triggerCarPhotoUpload(plate) {
    this.quickUploadTargetPlate = plate;
    const inp = document.getElementById("quick-car-photo-input");
    if (inp) {
      inp.value = "";
      inp.click();
    }
  },

  async onQuickCarPhotoSelected(input) {
    if (!input.files || input.files.length === 0 || !this.quickUploadTargetPlate) return;
    const plate = this.quickUploadTargetPlate;
    const file = input.files[0];
    const car = this.cars.find(c => c.plate === plate);
    if (!car) return;

    const formData = new FormData();
    formData.append("file", file);
    formData.append("angle", "front");

    try {
      this.showToast(`⏳ กำลังอัปโหลดรูปภาพสำหรับรถทะเบียน ${plate} ไปยัง Google Drive...`, "info");
      const cleanPlate = encodeURIComponent(plate.trim());
      const upRes = await fetch(`/api/cars/${cleanPlate}/images`, { method: "POST", body: formData });
      const upData = await upRes.json();
      if (!upData.success || !upData.url) {
        throw new Error(upData.detail || "อัปโหลดรูปภาพไม่สำเร็จ");
      }

      this.showToast(`✅ อัปเดตรูปภาพรถทะเบียน ${plate} เรียบร้อยแล้ว!`, "success");
      await this.loadCars();
    } catch (e) {
      this.showToast("❌ อัปโหลดรูปรถไม่สำเร็จ: " + e.message, "danger");
    }
  },

  normalizePlate(plate) {
    if (!plate) return "";
    return String(plate).replace(/[\s\-\.]+/g, "").toLowerCase();
  },

  checkDuplicatePlate(val) {
    const origPlate = (document.getElementById("edit-car-original-plate")?.value || "").trim();
    const warnEl = document.getElementById("edit-car-plate-warn");
    const clean = this.normalizePlate(val);
    if (!clean) {
      if (warnEl) warnEl.style.display = "none";
      return false;
    }
    const origClean = this.normalizePlate(origPlate);
    const dup = this.cars.find(c => {
      const cClean = this.normalizePlate(c.plate);
      if (origClean && cClean === origClean) return false;
      return cClean === clean;
    });
    if (dup) {
      if (warnEl) {
        warnEl.textContent = `⚠️ ทะเบียน '${val}' ซ้ำกับ '${dup.brand} ${dup.model}' (ทะเบียน ${dup.plate}) ในระบบแล้ว`;
        warnEl.style.display = "block";
      }
      return true;
    } else {
      if (warnEl) warnEl.style.display = "none";
      return false;
    }
  },

  checkDuplicateChassis(val) {
    const origPlate = (document.getElementById("edit-car-original-plate")?.value || "").trim();
    const warnEl = document.getElementById("edit-car-vin-warn");
    const cleanVin = String(val || "").trim().toUpperCase();
    if (!cleanVin || cleanVin === "-" || cleanVin.length < 8) {
      if (warnEl) warnEl.style.display = "none";
      return false;
    }
    const origClean = this.normalizePlate(origPlate);
    const dup = this.cars.find(c => {
      const cClean = this.normalizePlate(c.plate);
      if (origClean && cClean === origClean) return false;
      const existingVin = String(c.chassis_no || "").trim().toUpperCase();
      return existingVin && existingVin === cleanVin;
    });
    if (dup) {
      if (warnEl) {
        warnEl.textContent = `⚠️ เลขตัวถัง '${cleanVin}' ซ้ำกับ '${dup.brand} ${dup.model}' (ทะเบียน ${dup.plate})`;
        warnEl.style.display = "block";
      }
      return true;
    } else {
      if (warnEl) warnEl.style.display = "none";
      return false;
    }
  },

  updateCarFormField(field, val) {
    if (!this.carFormData) this.carFormData = {};
    this.carFormData[field] = val;
    if (field === 'engine_no') {
      this.carFormData.engine_no = val;
    } else if (field === 'act_policy_no') {
      this.carFormData.act_policy_no = val;
    } else if (field === 'act_company') {
      this.carFormData.act_company = val;
    } else if (field === 'ins_policy_no' || field === 'insurance_policy_no') {
      this.carFormData.ins_policy_no = val;
      this.carFormData.insurance_policy_no = val;
      this.carFormData.policy_no = val;
    } else if (field === 'reg_year' || field === 'register_year') {
      this.carFormData.register_year = val;
      this.carFormData.reg_year = val;
    } else if (field === 'ins_company' || field === 'insurance_company') {
      this.carFormData.insurance_company = val;
      this.carFormData.ins_company = val;
    } else if (field === 'prb_price' || field === 'act_price') {
      this.carFormData.prb_price = val;
      this.carFormData.act_price = val;
    } else if (field === 'insurance_premium' || field === 'ins_premium') {
      this.carFormData.insurance_premium = val;
      this.carFormData.ins_premium = val;
    } else if (field === 'next_service_mileage' || field === 'next_engine_oil_mileage') {
      this.carFormData.next_service_mileage = val;
      this.carFormData.next_engine_oil_mileage = val;
    } else if (field === 'next_service_date' || field === 'next_engine_oil_date') {
      this.carFormData.next_service_date = val;
      this.carFormData.next_engine_oil_date = val;
    } else if (field === 'finance_company') {
      this.carFormData.finance_company = val;
    }
  },

  clearCarPhoto() {
    const previewEl = document.getElementById("edit-car-img-preview");
    const noImgEl = document.getElementById("edit-car-no-img-text");
    const urlEl = document.getElementById("edit-car-image-url");
    const fileEl = document.getElementById("edit-car-photo-file");
    if (previewEl) {
      previewEl.src = "";
      previewEl.style.display = "none";
    }
    if (noImgEl) noImgEl.style.display = "block";
    if (urlEl) urlEl.value = "";
    if (fileEl) fileEl.value = "";
    if (this.carFormData) this.carFormData.image = "";
  },

  openEditCarModal(plate) {
    const isEn = (this.currentLang === "EN");
    const isNew = !plate;
    const car = (!isNew && this.cars.find(c => c.plate === plate)) || {};

    const regYearInit = (car.register_year && car.register_year !== '-') ? car.register_year : (car.reg_year || "-");
    const insCompInit = (car.insurance_company && car.insurance_company !== '-') ? car.insurance_company : (car.ins_company || "-");
    const prbPriceInit = car.prb_price !== undefined && car.prb_price !== null && car.prb_price !== "" ? car.prb_price : (car.act_price !== undefined && car.act_price !== null && car.act_price !== "" ? car.act_price : "");
    const insPremInit = car.insurance_premium !== undefined && car.insurance_premium !== null && car.insurance_premium !== "" ? car.insurance_premium : (car.ins_premium !== undefined && car.ins_premium !== null && car.ins_premium !== "" ? car.ins_premium : "");
    const nextMileageInit = car.next_service_mileage !== undefined && car.next_service_mileage !== null && Number(car.next_service_mileage) > 0
      ? car.next_service_mileage
      : (car.next_engine_oil_mileage && Number(car.next_engine_oil_mileage) > 0 ? car.next_engine_oil_mileage : "");
    const finCompInit = car.finance_company || "-";

    // Initialize carFormData state to prevent data loss on editing/typing
    this.carFormData = {
      plate: car.plate || "",
      brand: car.brand || "Toyota",
      model: car.model || "",
      car_group: car.car_group || "รถเก๋ง (Sedan/Hatchback)",
      fuel_type: car.fuel_system || car.fuel_type || "เบนซิน",
      fuel_system: car.fuel_system || car.fuel_type || "เบนซิน",
      engine_cc: car.cc_ev || car.engine_cc || "1200",
      cc_ev: car.cc_ev || car.engine_cc || "1200",
      company: car.owner_company || car.company || "บจก.สวัสดี เรนทัล (Sawasdee Rental)",
      owner_company: car.owner_company || car.company || "บจก.สวัสดี เรนทัล (Sawasdee Rental)",
      color: car.color || "",
      mileage: car.mileage || "15,000",
      price_day: car.daily_rate !== undefined ? car.daily_rate : (car.price_day !== undefined ? car.price_day : 1000),
      daily_rate: car.daily_rate !== undefined ? car.daily_rate : (car.price_day !== undefined ? car.price_day : 1000),
      price_week: car.weekly_rate !== undefined ? car.weekly_rate : (car.price_week !== undefined ? car.price_week : 6000),
      weekly_rate: car.weekly_rate !== undefined ? car.weekly_rate : (car.price_week !== undefined ? car.price_week : 6000),
      price_month: car.monthly_rate !== undefined ? car.monthly_rate : (car.price_month !== undefined ? car.price_month : 20000),
      monthly_rate: car.monthly_rate !== undefined ? car.monthly_rate : (car.price_month !== undefined ? car.price_month : 20000),
      chassis_no: car.vin || car.chassis_no || "-",
      vin: car.vin || car.chassis_no || "-",
      engine_no: (car.engine_no && car.engine_no !== "-") ? car.engine_no : "",
      tax_expiry: this.dmyToYmd(car.tax_expire_date || car.tax_expiry),
      tax_expire_date: this.dmyToYmd(car.tax_expire_date || car.tax_expiry),
      act_expiry: this.dmyToYmd(car.prb_expire_date || car.act_expiry),
      prb_expire_date: this.dmyToYmd(car.prb_expire_date || car.act_expiry),
      act_policy_no: (car.act_policy_no && car.act_policy_no !== "-") ? car.act_policy_no : "",
      act_company: (car.act_company && car.act_company !== "-") ? car.act_company : "",
      ins_policy_no: (car.ins_policy_no && car.ins_policy_no !== "-") ? car.ins_policy_no : ((car.insurance_policy_no && car.insurance_policy_no !== "-") ? car.insurance_policy_no : (car.policy_no && car.policy_no !== "-" ? car.policy_no : "")),
      insurance_policy_no: (car.ins_policy_no && car.ins_policy_no !== "-") ? car.ins_policy_no : ((car.insurance_policy_no && car.insurance_policy_no !== "-") ? car.insurance_policy_no : (car.policy_no && car.policy_no !== "-" ? car.policy_no : "")),
      policy_no: (car.ins_policy_no && car.ins_policy_no !== "-") ? car.ins_policy_no : ((car.insurance_policy_no && car.insurance_policy_no !== "-") ? car.insurance_policy_no : (car.policy_no && car.policy_no !== "-" ? car.policy_no : "")),
      ins_class: (car.ins_class && car.ins_class !== "-") ? car.ins_class : "-",
      ins_category: (car.ins_category && car.ins_category !== "-") ? car.ins_category : "",
      ins_coverage_amount: (car.ins_coverage_amount !== undefined && car.ins_coverage_amount !== null && Number(car.ins_coverage_amount) > 0) ? car.ins_coverage_amount : "",
      ins_type: (car.ins_type && car.ins_type !== "-") ? car.ins_type : "",
      ins_expiry: this.dmyToYmd(car.insurance_expire_date || car.ins_expiry),
      insurance_expire_date: this.dmyToYmd(car.insurance_expire_date || car.ins_expiry),
      ins_company: insCompInit,
      insurance_company: insCompInit,
      owner: car.car_owner || car.owner || "-",
      car_owner: car.car_owner || car.owner || "-",
      beneficiary: car.beneficiary || car.owner_company || car.company || "-",
      reg_year: regYearInit,
      register_year: regYearInit,
      prb_price: prbPriceInit,
      act_price: prbPriceInit,
      insurance_premium: insPremInit,
      ins_premium: insPremInit,
      last_service_date: this.dmyToYmd(car.last_service_date),
      next_service_date: this.dmyToYmd(car.next_service_date || car.next_engine_oil_date || car.next_service || ""),
      next_engine_oil_date: this.dmyToYmd(car.next_service_date || car.next_engine_oil_date || car.next_service || ""),
      next_service_mileage: nextMileageInit,
      next_engine_oil_mileage: nextMileageInit,
      notes: car.notes || "",
      status: car.car_status || car.status || "ว่างพร้อมใช้งาน",
      car_status: car.car_status || car.status || "ว่างพร้อมใช้งาน",
      is_debt_free: car.is_debt_free !== undefined ? Boolean(car.is_debt_free) : (!car.installment_amount),
      finance_company: finCompInit,
      installment_amount: car.installment_amount !== undefined ? car.installment_amount : 0,
      total_installments: car.total_installments !== undefined ? car.total_installments : 48,
      current_installment: car.current_installment !== undefined ? car.current_installment : 0,
      payment_due_date: this.dmyToYmd(car.payment_due_date),
      image: car.image_url || car.image || "",
      image_url: car.image_url || car.image || ""
    };

    const titleEl = document.getElementById("modal-edit-car-title");
    if (titleEl) {
      if (isEn) {
        titleEl.textContent = isNew
          ? "Add New Vehicle to Fleet"
          : `Edit Vehicle Details & Photo (${plate})`;
      } else {
        titleEl.textContent = isNew
          ? "เพิ่มรถยนต์ใหม่เข้าสู่ระบบ (Add New Vehicle)"
          : `แก้ไขข้อมูลรถยนต์ & อัปโหลดรูปรถ (${plate})`;
      }
    }

    const origPlateEl = document.getElementById("edit-car-original-plate");
    if (origPlateEl) origPlateEl.value = isNew ? "" : (car.plate || plate);

    const warnEl = document.getElementById("edit-car-plate-warn");
    if (warnEl) warnEl.style.display = "none";
    const vinWarnEl = document.getElementById("edit-car-vin-warn");
    if (vinWarnEl) vinWarnEl.style.display = "none";

    const delBtn = document.getElementById("btn-modal-car-delete");
    if (delBtn) {
      delBtn.style.display = isNew ? "none" : "inline-flex";
      delBtn.innerHTML = isEn ? "Delete This Vehicle" : "ลบข้อมูลรถยนต์คันนี้";
    }

    const cancelBtn = document.getElementById("btn-modal-car-cancel");
    if (cancelBtn) cancelBtn.textContent = isEn ? "Cancel" : "ยกเลิก";
    const saveBtn = document.getElementById("btn-submit-edit-car");
    if (saveBtn) saveBtn.textContent = isEn ? "Save Vehicle Data" : "บันทึกข้อมูลรถยนต์";

    const plateEl = document.getElementById("edit-car-plate");
    if (plateEl) {
      plateEl.value = car.plate || "";
      plateEl.readOnly = false;
      plateEl.style.background = "#FFFFFF";
    }

    const previewEl = document.getElementById("edit-car-img-preview");
    const noImgEl = document.getElementById("edit-car-no-img-text");
    const carImg = (car.image || "").trim();
    if (previewEl && noImgEl) {
      if (carImg) {
        previewEl.src = carImg;
        previewEl.style.display = "block";
        noImgEl.style.display = "none";
      } else {
        previewEl.src = "";
        previewEl.style.display = "none";
        noImgEl.style.display = "block";
      }
    }

    const urlEl = document.getElementById("edit-car-image-url");
    if (urlEl) urlEl.value = car.image || "";

    const fileEl = document.getElementById("edit-car-photo-file");
    if (fileEl) fileEl.value = "";

    const setVal = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.value = val !== undefined && val !== null ? val : "";
    };

    setVal("edit-car-brand", car.brand || "Toyota");
    setVal("edit-car-model", car.model || "");
    setVal("edit-car-group", car.car_group || "รถเก๋ง (Sedan/Hatchback)");
    setVal("edit-car-fuel", car.fuel_system || car.fuel_type || "เบนซิน");
    setVal("edit-car-cc", car.cc_ev || car.engine_cc || "1200");
    setVal("edit-car-company", car.owner_company || car.company || "บจก.สวัสดี เรนทัล (Sawasdee Rental)");
    setVal("edit-car-color", car.color || "");
    setVal("edit-car-mileage", car.mileage || "15,000");
    setVal("edit-car-pday", car.daily_rate !== undefined && car.daily_rate !== null ? car.daily_rate : (car.price_day !== undefined ? car.price_day : 1000));
    setVal("edit-car-pweek", car.weekly_rate !== undefined && car.weekly_rate !== null ? car.weekly_rate : (car.price_week !== undefined ? car.price_week : 6000));
    setVal("edit-car-pmonth", car.monthly_rate !== undefined && car.monthly_rate !== null ? car.monthly_rate : (car.price_month !== undefined ? car.price_month : 20000));
    setVal("edit-car-vin", car.vin || car.chassis_no || "-");
    setVal("edit-car-engine-no", (car.engine_no && car.engine_no !== "-") ? car.engine_no : "");
    setVal("edit-car-tax", this.dmyToYmd(car.tax_expire_date || car.tax_expiry));
    setVal("edit-car-act", this.dmyToYmd(car.prb_expire_date || car.act_expiry));
    setVal("edit-car-act-policy-no", (car.act_policy_no && car.act_policy_no !== "-") ? car.act_policy_no : "");
    setVal("edit-car-act-comp", (car.act_company && car.act_company !== "-") ? car.act_company : "");
    setVal("edit-car-ins", this.dmyToYmd(car.insurance_expire_date || car.ins_expiry));
    setVal("edit-car-ins-policy-no", (car.ins_policy_no && car.ins_policy_no !== "-") ? car.ins_policy_no : ((car.insurance_policy_no && car.insurance_policy_no !== "-") ? car.insurance_policy_no : (car.policy_no && car.policy_no !== "-" ? car.policy_no : "")));
    setVal("edit-car-ins-class", car.ins_class || "-");
    setVal("edit-car-ins-category", (car.ins_category && car.ins_category !== "-") ? car.ins_category : "");
    setVal("edit-car-ins-coverage-amount", (car.ins_coverage_amount !== undefined && car.ins_coverage_amount !== null && Number(car.ins_coverage_amount) > 0) ? car.ins_coverage_amount : "");
    setVal("edit-car-ins-type", (car.ins_type && car.ins_type !== "-") ? car.ins_type : "");
    setVal("edit-car-ins-comp", car.insurance_company || car.ins_company || "-");
    setVal("edit-car-ins-policy-no", (car.ins_policy_no && car.ins_policy_no !== "-") ? car.ins_policy_no : ((car.insurance_policy_no && car.insurance_policy_no !== "-") ? car.insurance_policy_no : (car.policy_no && car.policy_no !== "-" ? car.policy_no : "")));
    setVal("edit-car-ins-class", car.ins_class || "-");
    setVal("edit-car-ins-category", (car.ins_category && car.ins_category !== "-") ? car.ins_category : "");
    setVal("edit-car-ins-coverage-amount", (car.ins_coverage_amount !== undefined && car.ins_coverage_amount !== null && Number(car.ins_coverage_amount) > 0) ? car.ins_coverage_amount : "");
    setVal("edit-car-ins-type", (car.ins_type && car.ins_type !== "-") ? car.ins_type : "");
    setVal("edit-car-owner", car.car_owner || car.owner || "-");
    setVal("edit-car-beneficiary", car.beneficiary || car.owner_company || car.company || "-");
    setVal("edit-car-reg-year", car.register_year || car.reg_year || "-");
    setVal("edit-car-prb-price", car.prb_price !== undefined && car.prb_price !== null ? car.prb_price : (car.act_price !== undefined && car.act_price !== null ? car.act_price : ""));
    setVal("edit-car-ins-premium", car.insurance_premium !== undefined && car.insurance_premium !== null ? car.insurance_premium : (car.ins_premium !== undefined && car.ins_premium !== null ? car.ins_premium : ""));
    setVal("edit-car-last-srv", this.dmyToYmd(car.last_service_date));
    const srvDateVal = car.next_service_date || car.next_engine_oil_date || car.next_service || "";
    setVal("edit-car-next-srv-date", this.dmyToYmd(srvDateVal));
    const srvMileageVal = car.next_service_mileage !== undefined && car.next_service_mileage !== null && Number(car.next_service_mileage) > 0
      ? car.next_service_mileage
      : (car.next_engine_oil_mileage && Number(car.next_engine_oil_mileage) > 0 ? car.next_engine_oil_mileage : "");
    setVal("edit-car-next-srv-mileage", srvMileageVal);
    setVal("edit-car-notes", car.notes || "");
    setVal("edit-car-status", car.car_status || car.status || "ว่างพร้อมใช้งาน");
    setVal("edit-car-ins-doc-url", car.ins_doc_url || "");
    setVal("edit-car-img-front", car.img_front || "");
    setVal("edit-car-img-left", car.img_left || "");
    setVal("edit-car-img-rear", car.img_rear || "");
    setVal("edit-car-img-right", car.img_right || "");

    const isDebtFree = car.is_debt_free !== undefined ? Boolean(car.is_debt_free) : (!car.installment_amount);
    const debtFreeEl = document.getElementById("edit-car-debt-free");
    if (debtFreeEl) {
      debtFreeEl.checked = isDebtFree;
      this.onDebtFreeToggle(isDebtFree);
    }
    this.populateFinanceCompanyDropdown(car.finance_company || "");
    this.populateCarFormCreatableSelects();
    setVal("edit-car-installment-amount", car.installment_amount !== undefined ? car.installment_amount : 0);
    setVal("edit-car-total-installments", car.total_installments !== undefined ? car.total_installments : 48);
    setVal("edit-car-current-installment", car.current_installment !== undefined ? car.current_installment : 0);
    setVal("edit-car-payment-due-date", this.dmyToYmd(car.payment_due_date));

    this.openModal("modal-edit-car");
    setTimeout(() => {
      const plateEl = document.getElementById("edit-car-plate");
      if (plateEl) {
        plateEl.focus();
        if (isNew) plateEl.select();
      }
    }, 120);
  },

  onDebtFreeToggle(isDebtFree) {
    const fieldsContainer = document.getElementById("edit-car-installment-fields");
    if (fieldsContainer) {
      fieldsContainer.style.display = isDebtFree ? "none" : "block";
    }
  },

  getExistingFinanceCompanies() {
    const baseDefaults = [
      "โตโยต้า ลีสซิ่ง (Toyota Leasing)",
      "ทีทีบีไดรฟ์ / ธนชาต (ttb DRIVE)",
      "กรุงศรี ออโต้ (Krungsri Auto)",
      "กสิกร ลีสซิ่ง (KLeasing)",
      "ฮอนด้า ลีสซิ่ง (Honda Leasing)",
      "ไทยพาณิชย์ (SCB)",
      "เกียรตินาคินภัทร (KKP)",
      "ทิสโก้ (TISCO)"
    ];
    const found = new Set();
    (this.cars || []).forEach(c => {
      const fc = String(c.finance_company || "").trim();
      if (fc && !["-", "None", "none", "null", ""].includes(fc)) {
        found.add(fc);
      }
    });
    const combined = [...baseDefaults];
    Array.from(found).sort().forEach(item => {
      if (!combined.includes(item)) {
        combined.push(item);
      }
    });
    return combined;
  },

  async populateFinanceCompanyDropdown(selectedVal = "") {
    const inputEl = document.getElementById("edit-car-finance-company");
    const datalistEl = document.getElementById("finance-companies-list");
    if (!inputEl) return;

    let companies = [];
    try {
      const res = await fetch("/api/finance-companies");
      if (res.ok) {
        const data = await res.json();
        if (data && Array.isArray(data.companies) && data.companies.length > 0) {
          companies = data.companies;
        }
      }
    } catch (e) {
      console.warn("Could not fetch finance companies from API, using fallback", e);
    }

    if (!companies.length) {
      companies = this.getExistingFinanceCompanies();
    }

    if (datalistEl) {
      datalistEl.innerHTML = "";
      companies.forEach(comp => {
        const opt = document.createElement("option");
        opt.value = comp;
        datalistEl.appendChild(opt);
      });
    }

    const cleanSel = String(selectedVal || "").trim();
    if (cleanSel && !["-", "None", "none", "null"].includes(cleanSel)) {
      inputEl.value = cleanSel;
    } else {
      inputEl.value = "";
    }
  },

  onFinanceCompanyChange(val) {
    // Handled natively by single creatable/searchable datalist input
  },

  async populateCarFormCreatableSelects() {
    let opts = null;
    try {
      const res = await fetch("/api/cars/options");
      if (res.ok) {
        const data = await res.json();
        if (data && data.success) {
          opts = data;
        }
      }
    } catch (e) {
      console.warn("Could not fetch car options from API, fallback to client cars", e);
    }

    if (!opts) {
      const bSet = new Set(), mSet = new Set(), coSet = new Set(), clSet = new Set(), icSet = new Set(), owSet = new Set(), bfSet = new Set(), yrSet = new Set();
      (this.cars || []).forEach(c => {
        if (c.brand) bSet.add(c.brand);
        if (c.model) mSet.add(c.model);
        if (c.company) coSet.add(c.company);
        if (c.color) clSet.add(c.color);
        if (c.ins_company) icSet.add(c.ins_company);
        if (c.owner) owSet.add(c.owner);
        if (c.beneficiary) bfSet.add(c.beneficiary);
        if (c.reg_year) yrSet.add(String(c.reg_year));
      });
      opts = {
        brands: Array.from(bSet),
        models: Array.from(mSet),
        companies: Array.from(coSet),
        colors: Array.from(clSet),
        ins_companies: Array.from(icSet),
        owners: Array.from(owSet),
        beneficiaries: Array.from(bfSet),
        reg_years: Array.from(yrSet)
      };
    }

    const fillDatalist = (id, items) => {
      const dl = document.getElementById(id);
      if (!dl || !Array.isArray(items)) return;
      dl.innerHTML = "";
      items.forEach(val => {
        const clean = String(val || "").trim();
        if (clean && !["-", "None", "none", "null"].includes(clean)) {
          const opt = document.createElement("option");
          opt.value = clean;
          dl.appendChild(opt);
        }
      });
    };

    fillDatalist("car-brands-list", opts.brands);
    fillDatalist("car-models-list", opts.models);
    fillDatalist("car-companies-list", opts.companies);
    fillDatalist("car-colors-list", opts.colors);
    fillDatalist("car-ins-comps-list", opts.ins_companies);
    fillDatalist("car-owners-list", opts.owners);
    fillDatalist("car-beneficiaries-list", opts.beneficiaries);
    fillDatalist("car-reg-years-list", opts.reg_years);
  },

  onCarImageUrlInput(val) {
    const previewEl = document.getElementById("edit-car-img-preview");
    const noImgEl = document.getElementById("edit-car-no-img-text");
    const cleanUrl = String(val || "").trim();
    if (previewEl && noImgEl) {
      if (cleanUrl) {
        previewEl.src = cleanUrl;
        previewEl.style.display = "block";
        noImgEl.style.display = "none";
      } else {
        previewEl.src = "";
        previewEl.style.display = "none";
        noImgEl.style.display = "block";
      }
    }
  },

  async uploadCarAnglePhoto(input, angle) {
    if (!input.files || input.files.length === 0) return;
    const file = input.files[0];
    const plate = (this.carFormData && this.carFormData.plate) || 
                  (document.getElementById("edit-car-plate") && document.getElementById("edit-car-plate").value) ||
                  this.quickUploadTargetPlate || 
                  "car";

    const angleLabels = {
      front: "ด้านหน้า (Front)",
      left: "ด้านซ้าย (Left)",
      rear: "ด้านหลัง (Rear)",
      right: "ด้านขวา (Right)"
    };
    const angleColMap = {
      front: "img_front",
      left: "img_left",
      rear: "img_rear",
      right: "img_right"
    };
    const colName = angleColMap[angle] || "img_front";
    const angleText = angleLabels[angle] || angle;

    const formData = new FormData();
    formData.append("file", file);
    formData.append("angle", angle);

    try {
      this.showToast(`⏳ กำลังอัปโหลดรูปรถ (${angleText}) ไปยัง Google Drive...`, "info");
      const cleanPlate = encodeURIComponent(plate.trim());
      const res = await fetch(`/api/cars/${cleanPlate}/images`, {
        method: "POST",
        body: formData
      });
      const data = await res.json();
      if (!data.success || !data.url) {
        throw new Error(data.detail || data.error || "อัปโหลดรูปรถไม่สำเร็จ");
      }

      // 1. Update text input
      const inputEl = document.getElementById(`edit-car-${colName.replace('_', '-')}`);
      if (inputEl) {
        inputEl.value = data.url;
      }

      // 2. Update state
      if (!this.carFormData) this.carFormData = {};
      this.carFormData[colName] = data.url;
      if (angle === "front" || !this.carFormData.image) {
        this.carFormData.image = data.url;
        this.carFormData.image_url = data.url;
        const mainImgUrlEl = document.getElementById("edit-car-image-url");
        if (mainImgUrlEl) mainImgUrlEl.value = data.url;
        const prevEl = document.getElementById("edit-car-img-preview");
        if (prevEl) {
          prevEl.src = data.url;
          prevEl.style.display = "block";
        }
        const noImgEl = document.getElementById("edit-car-no-img-text");
        if (noImgEl) noImgEl.style.display = "none";
      }

      // 3. Immediately update this.cars in-memory cache so Car Details displays it without page refresh
      const normPlate = typeof this.normalizePlate === "function" ? this.normalizePlate(plate) : plate.replace(/[\s\-_]+/g, "");
      const matchedCar = (this.cars || []).find(c => c.plate === plate || (typeof this.normalizePlate === "function" && this.normalizePlate(c.plate) === normPlate));
      if (matchedCar) {
        matchedCar[colName] = data.url;
        if (angle === "front" || !matchedCar.image || matchedCar.image === "-") {
          matchedCar.image = data.url;
          matchedCar.image_url = data.url;
        }
      }

      const driveBadge = data.is_gdrive ? "ไปยัง Google Drive " : "";
      this.showToast(`✅ อัปโหลดรูปรถ (${angleText}) ${driveBadge}เรียบร้อยแล้ว!`, "success");
      input.value = "";
    } catch (e) {
      console.error("[UploadCarAnglePhoto Error]", e);
      this.showToast("❌ อัปโหลดรูปรถไม่สำเร็จ: " + e.message, "danger");
      input.value = "";
    }
  },

  async onEditCarModalPhotoSelected(input) {
    if (!input.files || input.files.length === 0) return;
    const file = input.files[0];
    const plate = (this.carFormData && this.carFormData.plate) || 
                  (document.getElementById("edit-car-plate") && document.getElementById("edit-car-plate").value) ||
                  "car";
    const formData = new FormData();
    formData.append("file", file);
    formData.append("angle", "front");

    try {
      this.showToast(`⏳ กำลังอัปโหลดรูปภาพ ${file.name} ไปยัง Google Drive...`, "info");
      const cleanPlate = encodeURIComponent(plate.trim());
      const res = await fetch(`/api/cars/${cleanPlate}/images`, { method: "POST", body: formData });
      const data = await res.json();
      if (data.success && data.url) {
        const previewEl = document.getElementById("edit-car-img-preview");
        const noImgEl = document.getElementById("edit-car-no-img-text");
        const urlEl = document.getElementById("edit-car-image-url");
        if (previewEl) {
          previewEl.src = data.url;
          previewEl.style.display = "block";
        }
        if (noImgEl) noImgEl.style.display = "none";
        if (urlEl) urlEl.value = data.url;
        if (this.carFormData) {
          this.carFormData.image = data.url;
          this.carFormData.image_url = data.url;
          this.carFormData.img_front = data.url;
        }
        const frontInput = document.getElementById("edit-car-img-front");
        if (frontInput && !frontInput.value) frontInput.value = data.url;
        const driveBadge = data.is_gdrive ? " (Google Drive)" : "";
        this.showToast(`✅ อัปโหลดรูปภาพเรียบร้อยแล้ว!${driveBadge}`, "success");
      } else {
        this.showToast("❌ อัปโหลดรูปไม่สำเร็จ: " + (data.detail || data.error || "เกิดข้อผิดพลาด"), "danger");
      }
    } catch (e) {
      this.showToast("❌ เกิดข้อผิดพลาดในการอัปโหลดรูป: " + e.message, "danger");
    }
  },

  async submitEditCar(e) {
    if (e && e.preventDefault) {
      e.preventDefault();
    } else if (window.event && window.event.preventDefault) {
      window.event.preventDefault();
    }

    const origPlate = (document.getElementById("edit-car-original-plate")?.value || "").trim();
    const fd = this.carFormData || {};
    const getVal = (id, fdKey, def = "") => {
      const el = document.getElementById(id);
      if (el && el.value !== undefined && el.value !== null && String(el.value).trim() !== "") {
        return el.value;
      }
      if (fd && fd[fdKey] !== undefined && fd[fdKey] !== null && String(fd[fdKey]).trim() !== "") {
        return fd[fdKey];
      }
      return el ? el.value : def;
    };

    const plate = String(getVal("edit-car-plate", "plate", "")).trim();
    const brand = String(getVal("edit-car-brand", "brand", "")).trim();
    const model = String(getVal("edit-car-model", "model", "")).trim();

    if (!plate) {
      this.showToast("⚠️ กรุณาระบุเลขทะเบียนรถ", "warning");
      return;
    }
    if (!brand || !model) {
      this.showToast("⚠️ กรุณาระบุยี่ห้อและรุ่นรถยนต์", "warning");
      return;
    }

    if (this.checkDuplicatePlate(plate)) {
      const msg = (this.currentLang === "EN")
        ? "Duplicate Data: Vehicle plate or VIN (Chassis No) already exists in system"
        : "ข้อมูลซ้ำ: พบเลขทะเบียนหรือเลขตัวถังนี้ในระบบแล้ว";
      alert(`⚠️ ${msg}`);
      this.showToast(`⚠️ ${msg}`, "danger");
      const plateEl = document.getElementById("edit-car-plate");
      if (plateEl) {
        plateEl.focus();
        plateEl.select();
      }
      return;
    }

    const vinVal = String(getVal("edit-car-vin", "vin", getVal("edit-car-vin", "chassis_no", "-"))).trim();
    if (this.checkDuplicateChassis(vinVal)) {
      const msg = (this.currentLang === "EN")
        ? "Duplicate Data: Vehicle plate or VIN (Chassis No) already exists in system"
        : "ข้อมูลซ้ำ: พบเลขทะเบียนหรือเลขตัวถังนี้ในระบบแล้ว";
      alert(`⚠️ ${msg}`);
      this.showToast(`⚠️ ${msg}`, "danger");
      const vinEl = document.getElementById("edit-car-vin");
      if (vinEl) {
        vinEl.focus();
        vinEl.select();
      }
      return;
    }

    const existing = this.cars.find(c => c.plate === (origPlate || plate)) || {};
    const imgUrl = (document.getElementById("edit-car-image-url")?.value || "").trim() || fd.image || existing.image || "";

    const rawPrb = getVal("edit-car-prb-price", "prb_price", getVal("edit-car-prb-price", "act_price", ""));
    const prbPrice = (rawPrb !== "" && rawPrb !== null && !isNaN(rawPrb)) ? parseFloat(rawPrb) : 0.0;
    const rawInsPrem = getVal("edit-car-ins-premium", "insurance_premium", getVal("edit-car-ins-premium", "ins_premium", ""));
    const insPremium = (rawInsPrem !== "" && rawInsPrem !== null && !isNaN(rawInsPrem)) ? parseFloat(rawInsPrem) : 0.0;

    const rawNextSrvDate = getVal("edit-car-next-srv-date", "next_service_date", getVal("edit-car-next-srv-date", "next_engine_oil_date", ""));
    const dmyNextSrvDate = rawNextSrvDate ? (rawNextSrvDate.includes("-") ? this.ymdToDmy(rawNextSrvDate) : rawNextSrvDate) : "-";
    const rawNextSrvMileage = getVal("edit-car-next-srv-mileage", "next_service_mileage", getVal("edit-car-next-srv-mileage", "next_engine_oil_mileage", "0"));
    const nextSrvMileage = parseFloat(rawNextSrvMileage || "0") || 0;

    const isDebtFree = document.getElementById("edit-car-debt-free") ? Boolean(document.getElementById("edit-car-debt-free").checked) : Boolean(fd.is_debt_free);
    const regYearVal = String(getVal("edit-car-reg-year", "register_year", getVal("edit-car-reg-year", "reg_year", "-"))).trim() || "-";
    const insCompVal = String(getVal("edit-car-ins-comp", "insurance_company", getVal("edit-car-ins-comp", "ins_company", "-"))).trim() || "-";
    const finCompVal = isDebtFree ? "-" : (String(getVal("edit-car-finance-company", "finance_company", "-")).trim() || "-");

    const payload = {
      original_plate: origPlate,
      plate: plate,
      brand: brand,
      model: model,
      car_group: getVal("edit-car-group", "car_group", "รถเก๋ง (Sedan/Hatchback)"),
      fuel_system: getVal("edit-car-fuel", "fuel_system", getVal("edit-car-fuel", "fuel_type", "เบนซิน")),
      fuel_type: getVal("edit-car-fuel", "fuel_system", getVal("edit-car-fuel", "fuel_type", "เบนซิน")),
      cc_ev: String(getVal("edit-car-cc", "cc_ev", getVal("edit-car-cc", "engine_cc", "1200"))).trim(),
      engine_cc: String(getVal("edit-car-cc", "cc_ev", getVal("edit-car-cc", "engine_cc", "1200"))).trim(),
      owner_company: String(getVal("edit-car-company", "owner_company", getVal("edit-car-company", "company", "Sawasdee Rent A Car"))).trim(),
      company: String(getVal("edit-car-company", "owner_company", getVal("edit-car-company", "company", "Sawasdee Rent A Car"))).trim(),
      color: String(getVal("edit-car-color", "color", "-")).trim(),
      mileage: String(getVal("edit-car-mileage", "mileage", "0")).trim(),
      daily_rate: parseInt(getVal("edit-car-pday", "daily_rate", getVal("edit-car-pday", "price_day", 1000)) || "1000", 10),
      price_day: parseInt(getVal("edit-car-pday", "daily_rate", getVal("edit-car-pday", "price_day", 1000)) || "1000", 10),
      weekly_rate: parseInt(getVal("edit-car-pweek", "weekly_rate", getVal("edit-car-pweek", "price_week", 6000)) || "6000", 10),
      price_week: parseInt(getVal("edit-car-pweek", "weekly_rate", getVal("edit-car-pweek", "price_week", 6000)) || "6000", 10),
      monthly_rate: parseInt(getVal("edit-car-pmonth", "monthly_rate", getVal("edit-car-pmonth", "price_month", 20000)) || "20000", 10),
      price_month: parseInt(getVal("edit-car-pmonth", "monthly_rate", getVal("edit-car-pmonth", "price_month", 20000)) || "20000", 10),
      vin: vinVal,
      chassis_no: vinVal,
      engine_no: String(getVal("edit-car-engine-no", "engine_no", "-")).trim() || "-",
      tax_expire_date: this.ymdToDmy(getVal("edit-car-tax", "tax_expire_date", getVal("edit-car-tax", "tax_expiry", ""))) || "-",
      tax_expiry: this.ymdToDmy(getVal("edit-car-tax", "tax_expire_date", getVal("edit-car-tax", "tax_expiry", ""))) || "-",
      prb_expire_date: this.ymdToDmy(getVal("edit-car-act", "prb_expire_date", getVal("edit-car-act", "act_expiry", ""))) || "-",
      act_expiry: this.ymdToDmy(getVal("edit-car-act", "prb_expire_date", getVal("edit-car-act", "act_expiry", ""))) || "-",
      act_policy_no: String(getVal("edit-car-act-policy-no", "act_policy_no", "-")).trim() || "-",
      act_company: String(getVal("edit-car-act-comp", "act_company", "-")).trim() || "-",
      insurance_expire_date: this.ymdToDmy(getVal("edit-car-ins", "insurance_expire_date", getVal("edit-car-ins", "ins_expiry", ""))) || "-",
      ins_expiry: this.ymdToDmy(getVal("edit-car-ins", "insurance_expire_date", getVal("edit-car-ins", "ins_expiry", ""))) || "-",
      ins_policy_no: String(getVal("edit-car-ins-policy-no", "ins_policy_no", getVal("edit-car-ins-policy-no", "insurance_policy_no", getVal("edit-car-ins-policy-no", "policy_no", "-")))).trim() || "-",
      insurance_policy_no: String(getVal("edit-car-ins-policy-no", "ins_policy_no", getVal("edit-car-ins-policy-no", "insurance_policy_no", getVal("edit-car-ins-policy-no", "policy_no", "-")))).trim() || "-",
      policy_no: String(getVal("edit-car-ins-policy-no", "ins_policy_no", getVal("edit-car-ins-policy-no", "insurance_policy_no", getVal("edit-car-ins-policy-no", "policy_no", "-")))).trim() || "-",
      ins_class: String(getVal("edit-car-ins-class", "ins_class", "-")).trim() || "-",
      ins_category: String(getVal("edit-car-ins-category", "ins_category", "-")).trim() || "-",
      ins_coverage_amount: parseFloat(getVal("edit-car-ins-coverage-amount", "ins_coverage_amount", "0")) || 0.0,
      ins_type: String(getVal("edit-car-ins-type", "ins_type", "-")).trim() || "-",
      insurance_company: insCompVal,
      ins_company: insCompVal,
      car_owner: String(getVal("edit-car-owner", "car_owner", getVal("edit-car-owner", "owner", "-"))).trim(),
      owner: String(getVal("edit-car-owner", "car_owner", getVal("edit-car-owner", "owner", "-"))).trim(),
      owner_name: String(getVal("edit-car-owner", "car_owner", getVal("edit-car-owner", "owner", "-"))).trim(),
      beneficiary: String(getVal("edit-car-beneficiary", "beneficiary", "-")).trim(),
      register_year: regYearVal,
      registration_year: regYearVal,
      reg_year: regYearVal,
      prb_price: prbPrice,
      act_price: prbPrice,
      insurance_premium: insPremium,
      ins_premium: insPremium,
      last_service_date: this.ymdToDmy(getVal("edit-car-last-srv", "last_service_date", "")) || "-",
      next_service_date: dmyNextSrvDate,
      next_engine_oil_date: dmyNextSrvDate,
      next_service_mileage: nextSrvMileage,
      next_engine_oil_mileage: nextSrvMileage,
      next_service: dmyNextSrvDate !== "-" ? dmyNextSrvDate : (nextSrvMileage > 0 ? String(nextSrvMileage) : "-"),
      notes: String(getVal("edit-car-notes", "notes", "")).trim(),
      ins_doc_url: String(getVal("edit-car-ins-doc-url", "ins_doc_url", "")).trim(),
      img_front: String(getVal("edit-car-img-front", "img_front", "")).trim(),
      img_left: String(getVal("edit-car-img-left", "img_left", "")).trim(),
      img_rear: String(getVal("edit-car-img-rear", "img_rear", "")).trim(),
      img_right: String(getVal("edit-car-img-right", "img_right", "")).trim(),
      car_status: getVal("edit-car-status", "car_status", getVal("edit-car-status", "status", "ว่างพร้อมใช้งาน")),
      status: getVal("edit-car-status", "car_status", getVal("edit-car-status", "status", "ว่างพร้อมใช้งาน")),
      image_url: imgUrl,
      image: imgUrl,
      is_debt_free: isDebtFree,
      finance_company: finCompVal,
      installment_amount: isDebtFree ? 0 : (parseFloat(getVal("edit-car-installment-amount", "installment_amount", 0)) || 0),
      total_installments: isDebtFree ? 0 : (parseInt(getVal("edit-car-total-installments", "total_installments", 0), 10) || 0),
      current_installment: isDebtFree ? 0 : (parseInt(getVal("edit-car-current-installment", "current_installment", 0), 10) || 0),
      payment_due_date: isDebtFree || !getVal("edit-car-payment-due-date", "payment_due_date", "") ? "-" : String(getVal("edit-car-payment-due-date", "payment_due_date", "-")).trim()
    };

    try {
      let res = await fetch("/api/vehicles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (res.status === 404) {
        res = await fetch("/api/cars", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
      }
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        this.closeModal("modal-edit-car");
        if (origPlate && origPlate !== plate) {
          const oldIdx = this.cars.findIndex(c => c.plate === origPlate);
          if (oldIdx >= 0) this.cars.splice(oldIdx, 1);
        }
        const idx = this.cars.findIndex(c => c.plate === plate);
        if (idx >= 0) {
          Object.assign(this.cars[idx], payload);
        } else {
          this.cars.unshift(payload);
        }
        this.renderFleetCards();
        this.renderFleetOverviewTable();
        this.populateFleetDropdowns();
        const successMsg = (this.currentLang === "EN")
          ? `Vehicle data saved successfully (${plate})`
          : `บันทึกข้อมูลรถยนต์ทะเบียน ${plate} เรียบร้อยแล้ว!`;
        this.showToast(`✅ ${successMsg}`, "success");
        this.loadCars().catch(err => console.error("loadCars background err:", err));
      } else {
        const isEn = (this.currentLang === "EN");
        let errMsg = data.message || data.detail || (isEn ? "Failed to save vehicle" : "บันทึกข้อมูลไม่สำเร็จ");
        if (typeof errMsg === "object" && errMsg.message) errMsg = errMsg.message;
        if (res.status === 409 || data.error === "duplicate_vehicle") {
          errMsg = this.t("duplicate_vehicle_error");
          const plateEl = document.getElementById("edit-car-plate");
          if (plateEl) {
            plateEl.focus();
            plateEl.select();
          }
        }
        this.showToast(`⚠️ ${errMsg}`, "danger");
      }
    } catch (e) {
      this.showToast("❌ เกิดข้อผิดพลาด: " + e.message, "danger");
    }
  },

  async deleteCurrentEditingCar() {
    const origPlate = (document.getElementById("edit-car-original-plate")?.value || "").trim();
    const plate = (document.getElementById("edit-car-plate")?.value || "").trim();
    const target = origPlate || plate;
    if (!target) return;
    const ok = await this.deleteCarByPlate(target);
    if (ok) {
      this.closeModal("modal-edit-car");
    }
  },

  async deleteCarByPlate(plate) {
    if (!plate) return false;
    const car = this.cars.find(c => c.plate === plate) || {};
    const label = car.brand && car.model ? `${car.brand} ${car.model} (${plate})` : plate;
    const conf = confirm(`คุณแน่ใจหรือไม่ว่าต้องการลบรถยนต์ "${label}" ออกจากระบบ?\n\n⚠️ คำเตือน: ระบบจะไม่อนุญาตให้ลบหากมีรายการจองหรือสัญญาที่ยังไม่เสร็จสิ้น`);
    if (!conf) return false;

    try {
      this.showToast(`⏳ กำลังลบข้อมูลรถยนต์ ${plate}...`, "info");
      const res = await fetch(`/api/cars/${encodeURIComponent(plate)}`, {
        method: "DELETE"
      });
      const data = await res.json();
      if (res.ok && data.success) {
        const norm = this.normalizePlate(plate);
        this.cars = this.cars.filter(c => c.plate !== plate && this.normalizePlate(c.plate) !== norm);
        this.renderFleetCards();
        this.renderFleetOverviewTable();
        this.populateFleetDropdowns();
        this.showToast(`🗑️ ลบข้อมูลรถยนต์ทะเบียน ${plate} เรียบร้อยแล้ว!`, "success");
        await this.loadCars();
        return true;
      } else {
        alert("❌ ไม่สามารถลบรถยนต์คันนี้ได้:\n" + (data.detail || "เกิดข้อผิดพลาดในการลบ"));
        this.showToast("❌ ลบไม่สำเร็จ: " + (data.detail || "เกิดข้อผิดพลาด"), "danger");
        return false;
      }
    } catch (e) {
      this.showToast("❌ เกิดข้อผิดพลาด: " + e.message, "danger");
      return false;
    }
  },

  openCarScheduleModal(plate, monthOffset = 0) {
    if (!plate) return;
    const cleanPlate = String(plate).trim();
    const car = (this.cars || []).find(c => c.plate === cleanPlate) || { plate: cleanPlate };
    const normPlate = this.normalizePlate ? this.normalizePlate(cleanPlate) : cleanPlate.replace(/\s+/g, "").toUpperCase();
    const isEn = this.currentLang === "EN";

    // Active bookings for this car
    const carBookings = (this.bookings || []).filter(b => {
      const bPlate = this.normalizePlate ? this.normalizePlate(b.car_id || b.car_plate || "") : String(b.car_id || b.car_plate || "").replace(/\s+/g, "").toUpperCase();
      if (bPlate !== normPlate) return false;
      const st = String(b.status || "").trim();
      return !["ยกเลิก", "Canceled", "canceled"].includes(st);
    });

    // Month offset tracking
    if (this._carSchedMonthOffset === undefined || monthOffset === 0) {
      this._carSchedMonthOffset = (monthOffset === 0 && this._currentSchedPlate === cleanPlate) ? (this._carSchedMonthOffset || 0) : 0;
      this._currentSchedPlate = cleanPlate;
    } else {
      this._carSchedMonthOffset += monthOffset;
    }

    const today = new Date();
    const viewDate = new Date(today.getFullYear(), today.getMonth() + this._carSchedMonthOffset, 1);
    const year = viewDate.getFullYear();
    const month = viewDate.getMonth(); // 0-indexed

    const monthNamesTh = ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"];
    const monthNamesEn = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    const monthTitle = isEn ? `${monthNamesEn[month]} ${year}` : `${monthNamesTh[month]} ${year + 543}`;

    // Map each date YYYY-MM-DD
    // Color logic:
    // Yellow: Dates in "ติดจอง (Reserved)"
    // Red: Dates in "กำลังเช่า (On Rent)"
    const dateMap = {};
    carBookings.forEach(b => {
      const sStr = b.start_date ? b.start_date.split("T")[0] : null;
      const eStr = b.end_date ? b.end_date.split("T")[0] : null;
      if (!sStr || !eStr) return;

      const isRenting = (b.status === "กำลังเช่า" || b.status === "รอรับคืน" || b.status === "On rent");

      let curr = new Date(sStr + "T00:00:00");
      const endD = new Date(eStr + "T00:00:00");
      while (curr <= endD) {
        const dKey = curr.toISOString().split("T")[0];
        if (!dateMap[dKey]) dateMap[dKey] = [];
        dateMap[dKey].push({
          booking: b,
          type: isRenting ? "rent" : "reserved"
        });
        curr.setDate(curr.getDate() + 1);
      }
    });

    const firstDayIndex = new Date(year, month, 1).getDay();
    const totalDays = new Date(year, month + 1, 0).getDate();
    const todayStr = this.getThaiDateTime ? this.getThaiDateTime(0).date : new Date().toISOString().split("T")[0];

    const dayHeaders = isEn ? ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] : ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"];

    let calendarCells = "";
    for (let i = 0; i < firstDayIndex; i++) {
      calendarCells += `<div style="background:#F8FAFC; border:1px solid #E2E8F0; min-height:60px; border-radius:6px; opacity:0.35;"></div>`;
    }

    for (let day = 1; day <= totalDays; day++) {
      const dStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const isToday = dStr === todayStr;
      const entries = dateMap[dStr] || [];

      let cellBg = "#FFFFFF";
      let cellBorder = isToday ? "#3B82F6" : "#E2E8F0";
      let cellTextColor = "#1E293B";
      let badgeHtml = "";

      const hasRent = entries.some(e => e.type === "rent");
      const hasReserved = entries.some(e => e.type === "reserved");

      if (hasRent) {
        // Red: Dates in "กำลังเช่า (On Rent)"
        cellBg = "#FEE2E2";
        cellBorder = "#F87171";
        cellTextColor = "#991B1B";
        badgeHtml = `<span style="font-size:10px; font-weight:700; background:#DC2626; color:#FFF; padding:1px 5px; border-radius:4px; display:inline-block; margin-top:2px;">${isEn ? 'On Rent' : 'กำลังเช่า'}</span>`;
      } else if (hasReserved) {
        // Yellow: Dates in "ติดจอง (Reserved)"
        cellBg = "#FEF08A";
        cellBorder = "#FACC15";
        cellTextColor = "#854D0E";
        badgeHtml = `<span style="font-size:10px; font-weight:700; background:#CA8A04; color:#FFF; padding:1px 5px; border-radius:4px; display:inline-block; margin-top:2px;">${isEn ? 'Booked' : 'ติดจอง'}</span>`;
      }

      calendarCells += `
        <div style="background:${cellBg}; border:1px solid ${cellBorder}; border-radius:6px; min-height:60px; padding:4px 6px; display:flex; flex-direction:column; justify-content:space-between; ${isToday ? 'box-shadow:0 0 0 2px #93C5FD;' : ''}">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <b style="font-size:12px; color:${cellTextColor};">${day}</b>
            ${isToday ? `<span style="font-size:9px; background:#3B82F6; color:#FFF; padding:0 4px; border-radius:3px;">${isEn ? 'Today' : 'วันนี้'}</span>` : ''}
          </div>
          <div>${badgeHtml}</div>
        </div>
      `;
    }

    const modalTitleEl = document.getElementById("modal-car-schedule-title");
    if (modalTitleEl) {
      modalTitleEl.innerHTML = `
        ${isEn ? 'Vehicle Schedule & Queue' : 'ปฏิทินคิวงานของรถ'}: 
        <b>${car.brand || ''} ${car.model || ''}</b> 
        <span style="background:#1E293B; color:#FFF; padding:2px 8px; border-radius:5px; font-size:12px; margin-left:6px;">${car.plate || cleanPlate}</span>
      `;
    }

    const bodyEl = document.getElementById("modal-car-schedule-body");
    if (bodyEl) {
      bodyEl.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px; background:#FAF7F2; padding:10px 14px; border-radius:8px; margin-bottom:12px;">
          <div style="display:flex; gap:16px; align-items:center; flex-wrap:wrap;">
            <div style="display:flex; align-items:center; gap:6px; font-size:12px; font-weight:700; color:#991B1B;">
              <span style="width:12px; height:12px; border-radius:3px; background:#F87171; display:inline-block;"></span>
              🔴 ${isEn ? 'On Rent' : 'กำลังเช่า'} (${carBookings.filter(b => b.status === "กำลังเช่า" || b.status === "รอรับคืน").length})
            </div>
            <div style="display:flex; align-items:center; gap:6px; font-size:12px; font-weight:700; color:#854D0E;">
              <span style="width:12px; height:12px; border-radius:3px; background:#FACC15; display:inline-block;"></span>
              🟡 ${isEn ? 'Reserved / Booked' : 'ติดจอง / เตรียมส่งมอบ'} (${carBookings.filter(b => b.status !== "กำลังเช่า" && b.status !== "รอรับคืน").length})
            </div>
            <div style="display:flex; align-items:center; gap:6px; font-size:12px; font-weight:600; color:#166534;">
              <span style="width:12px; height:12px; border-radius:3px; background:#86EFAC; display:inline-block;"></span>
              🟢 ${isEn ? 'Available' : 'ว่างพร้อมใช้งาน'}
            </div>
          </div>
          <div style="display:flex; gap:6px; align-items:center;">
            <button type="button" class="btn btn-sm btn-secondary" onclick="app.openCarScheduleModal('${cleanPlate}', -1)" style="padding:3px 10px; font-size:12px;">◀ ${isEn ? 'Prev Month' : 'เดือนก่อนหน้า'}</button>
            <span style="font-weight:700; font-size:13px; color:#1E293B; min-width:130px; text-align:center;">${monthTitle}</span>
            <button type="button" class="btn btn-sm btn-secondary" onclick="app.openCarScheduleModal('${cleanPlate}', 1)" style="padding:3px 10px; font-size:12px;">${isEn ? 'Next Month' : 'เดือนถัดไป'} ▶</button>
          </div>
        </div>

        <div style="display:grid; grid-template-columns: repeat(7, 1fr); gap:6px; margin-bottom:16px;">
          ${dayHeaders.map(h => `<div style="text-align:center; font-weight:700; font-size:11.5px; color:#64748B; padding:4px 0;">${h}</div>`).join("")}
          ${calendarCells}
        </div>

        <div style="background:#FFF; border:1px solid #E2E8F0; border-radius:8px; padding:12px; margin-top:12px;">
          <div style="font-size:13px; font-weight:700; color:#1E293B; margin-bottom:8px; display:flex; justify-content:space-between; align-items:center;">
            <span>📋 ${isEn ? 'Bookings & Queue for this Car' : 'รายการจองและคิวงานทั้งหมดของรถคันนี้'} (${carBookings.length})</span>
            <button type="button" class="btn btn-sm btn-primary" onclick="app.closeModal('modal-car-schedule'); app.openBookModal('${cleanPlate}');" style="padding:4px 10px; font-size:11.5px;">
              ➕ ${isEn ? 'New Booking for this Car' : 'จองรถคันนี้'}
            </button>
          </div>
          ${carBookings.length === 0 ? `
            <div style="text-align:center; padding:18px; color:#94A3B8; font-size:12.5px;">
              ${isEn ? 'No active bookings or reservations found for this vehicle.' : 'ไม่มีประวัติหรือคิวงานจองที่ค้างอยู่ รถพร้อมให้บริการ'}
            </div>
          ` : `
            <div class="table-responsive" style="max-height:220px; overflow-y:auto;">
              <table class="table" style="font-size:11.5px; margin:0;">
                <thead>
                  <tr style="background:#F8FAFC;">
                    <th>${isEn ? 'Booking ID' : 'รหัสจอง'}</th>
                    <th>${isEn ? 'Customer' : 'ผู้เช่า'}</th>
                    <th>${isEn ? 'Rental Period' : 'ช่วงเวลาเช่า'}</th>
                    <th style="text-align:center;">${isEn ? 'Status' : 'สถานะ'}</th>
                    <th style="text-align:right;">${isEn ? 'Net Price' : 'ยอดสุทธิ'}</th>
                    <th style="text-align:center;">${isEn ? 'Action' : 'จัดการ'}</th>
                  </tr>
                </thead>
                <tbody>
                  ${carBookings.map(b => {
                    const isRent = b.status === "กำลังเช่า" || b.status === "รอรับคืน";
                    const bgBadge = isRent ? "#FEE2E2" : "#FEF08A";
                    const colBadge = isRent ? "#991B1B" : "#854D0E";
                    const sDt = `${b.start_date ? b.start_date.split('T')[0] : ''} ${b.start_time || ''}`;
                    const eDt = `${b.end_date ? b.end_date.split('T')[0] : ''} ${b.end_time || ''}`;
                    return `
                      <tr>
                        <td><b>${b.booking_id}</b></td>
                        <td>${b.customer_name || '-'}</td>
                        <td>${sDt} ➔ ${eDt}</td>
                        <td style="text-align:center;">
                          <span style="background:${bgBadge}; color:${colBadge}; padding:2px 8px; border-radius:4px; font-weight:700;">
                            ${b.status}
                          </span>
                        </td>
                        <td style="text-align:right; font-weight:700;">฿${Number(b.net_price || 0).toLocaleString()}</td>
                        <td style="text-align:center;">
                          <button type="button" class="btn btn-sm btn-secondary" onclick="app.closeModal('modal-car-schedule'); app.goToTabWithBooking('assign', '${b.booking_id}');" style="padding:2px 6px; font-size:10.5px;">
                            ${isEn ? 'View' : 'ดูใบงาน'}
                          </button>
                        </td>
                      </tr>
                    `;
                  }).join("")}
                </tbody>
              </table>
            </div>
          `}
        </div>

        <div style="display:flex; justify-content:flex-end; margin-top:14px;">
          <button type="button" class="btn btn-secondary" onclick="app.closeModal('modal-car-schedule')" style="padding:6px 16px; font-size:12px;">
            ${isEn ? 'Close' : 'ปิดหน้าต่าง'} (✕)
          </button>
        </div>
      `;
    }

    const m = document.getElementById("modal-car-schedule");
    if (m) {
      m.style.display = "flex";
    }
    this.openModal("modal-car-schedule");
  },

  async loadCarInsuranceRecords(plate) {
    const isEn = (this.currentLang === "EN");
    const cleanPlate = String(plate || "").trim();
    if (!cleanPlate) return;
    const tbody = document.getElementById("car-details-ins-tbody");
    if (!tbody) return;

    try {
      const res = await fetch(`/api/cars/${encodeURIComponent(cleanPlate)}/insurance-records`);
      if (!res.ok) throw new Error("Failed to load insurance records");
      const data = await res.json();
      const records = data.records || [];

      if (!records.length) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:#94A3B8; padding:12px;">${isEn ? 'No insurance records found for this vehicle' : 'ยังไม่มีประวัติการต่อประกัน/พ.ร.บ. สำหรับรถคันนี้'}</td></tr>`;
        return;
      }

      tbody.innerHTML = records.map(r => {
        const exp = r.expiry_date || "-";
        const comp = r.insurance_company || "-";
        const cat = r.ins_category || r.ins_type || r.type || "";
        const polNo = r.policy_no || "-";
        const prem = Number(r.premium || 0);
        const premStr = prem > 0 ? "฿" + prem.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2}) : "-";
        const docUrl = r.ins_doc_url || "";
        const docBtn = docUrl ? `<a href="${docUrl}" target="_blank" rel="noopener noreferrer" class="btn btn-sm" style="padding:1px 8px; font-size:10.5px; background:#EFF6FF; border:1px solid #3B82F6; color:#1D4ED8; font-weight:700; text-decoration:none;">📄 เปิดดู ↗</a>` : `<span style="color:#94A3B8;">-</span>`;

        return `
          <tr>
            <td style="padding:6px 8px; font-weight:700; color:#DC2626;">${exp}</td>
            <td style="padding:6px 8px;">${comp} ${cat ? `<span style="color:#64748B; font-size:10.5px;">(${cat})</span>` : ''}</td>
            <td style="padding:6px 8px;"><code>${polNo}</code></td>
            <td style="padding:6px 8px; text-align:right; font-weight:700; color:#0F172A;">${premStr}</td>
            <td style="padding:6px 8px; text-align:center;">${docBtn}</td>
          </tr>
        `;
      }).join("");
    } catch (err) {
      console.warn("loadCarInsuranceRecords error:", err);
      tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:#EF4444; padding:12px;">${isEn ? 'Failed to load insurance records' : 'โหลดข้อมูลประวัติกรมธรรม์ไม่สำเร็จ'}</td></tr>`;
    }
  },

  async loadCarMaintenances(plate) {
    const isEn = (this.currentLang === "EN");
    const cleanPlate = String(plate || "").trim();
    if (!cleanPlate) return;

    const tbody = document.getElementById("car-details-maint-tbody");
    const incEl = document.getElementById("car-roi-income");
    const costEl = document.getElementById("car-roi-cost");
    const profitEl = document.getElementById("car-roi-profit");
    const badgeEl = document.getElementById("car-roi-badge");
    const cardEl = document.getElementById("car-roi-profit-card");

    try {
      const res = await fetch(`/api/cars/${encodeURIComponent(cleanPlate)}/maintenances`);
      if (!res.ok) throw new Error("Failed to load maintenances");
      const data = await res.json();

      const totalInc = Number(data.total_income || 0);
      const totalCost = Number(data.total_maintenance_cost || 0);
      const netProfit = Number(data.net_profit_roi || 0);

      if (incEl) incEl.textContent = "฿" + totalInc.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2});
      if (costEl) costEl.textContent = "฿" + totalCost.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2});
      if (profitEl) {
        profitEl.textContent = (netProfit >= 0 ? "+฿" : "-฿") + Math.abs(netProfit).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2});
        profitEl.style.color = netProfit >= 0 ? "#16A34A" : "#DC2626";
      }
      if (cardEl) {
        cardEl.style.background = netProfit >= 0 ? "#F0FDF4" : "#FEF2F2";
        cardEl.style.borderColor = netProfit >= 0 ? "#BBF7D0" : "#FECACA";
      }
      if (badgeEl) {
        if (netProfit >= 0) {
          badgeEl.textContent = isEn ? "ROI: Profitable" : "กำไรสุทธิ (ROI บวก)";
          badgeEl.style.background = "#DCFCE7";
          badgeEl.style.color = "#15803D";
          badgeEl.style.border = "1px solid #86EFAC";
        } else {
          badgeEl.textContent = isEn ? "ROI: Loss" : "ขาดทุนสุทธิ (ROI ลบ)";
          badgeEl.style.background = "#FEE2E2";
          badgeEl.style.color = "#991B1B";
          badgeEl.style.border = "1px solid #FCA5A5";
        }
      }

      if (tbody) {
        const records = data.records || [];
        if (records.length === 0) {
          tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; color:#94A3B8; padding:12px;">${isEn ? 'No maintenance records yet' : 'ยังไม่มีประวัติการซ่อมบำรุง'}</td></tr>`;
        } else {
          tbody.innerHTML = records.map(r => {
            const costNum = Number(r.cost || 0);
            const safeId = String(r.id || "");
            const safePl = String(cleanPlate).replace(/'/g, "\\'");
            const typeBadge = r.expense_type ? `<span style="display:inline-block; font-size:10.5px; font-weight:700; background:#EFF6FF; color:#1D4ED8; border:1px solid #BFDBFE; border-radius:4px; padding:1px 6px; margin-right:6px;">${r.expense_type}</span>` : '';
            return `
              <tr>
                <td style="padding:6px 8px; white-space:nowrap; font-weight:600;">${r.date || '-'}</td>
                <td style="padding:6px 8px;">${typeBadge}${r.description || '-'}</td>
                <td style="padding:6px 8px; text-align:right; font-weight:700; color:#E11D48;">฿${costNum.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
                <td style="padding:6px 8px; text-align:center;">
                  <button type="button" onclick="app.deleteCarMaintenance('${safePl}', '${safeId}')" class="btn btn-sm btn-danger" style="padding:2px 6px; font-size:11px;" title="${isEn ? 'Delete' : 'ลบ'}">
                    ✕
                  </button>
                </td>
              </tr>
            `;
          }).join("");
        }
      }
    } catch (err) {
      console.error("loadCarMaintenances error:", err);
      if (tbody) {
        tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; color:#EF4444; padding:12px;">${isEn ? 'Failed to load maintenance records' : 'โหลดข้อมูลประวัติซ่อมไม่สำเร็จ'}</td></tr>`;
      }
    }
  },

  async submitCarMaintenance(plate) {
    const isEn = (this.currentLang === "EN");
    const dateInput = document.getElementById("maint-input-date");
    const descInput = document.getElementById("maint-input-desc");
    const costInput = document.getElementById("maint-input-cost");

    const mDate = dateInput ? dateInput.value.trim() : "";
    const mDesc = descInput ? descInput.value.trim() : "";
    const mCost = costInput ? parseFloat(costInput.value) || 0 : 0;

    if (!mDesc) {
      this.showToast(isEn ? "Please enter maintenance description" : "กรุณาระบุรายละเอียดการซ่อม", "danger");
      return;
    }

    try {
      const res = await fetch(`/api/cars/${encodeURIComponent(plate)}/maintenances`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date: mDate || new Date().toISOString().split("T")[0],
          description: mDesc,
          cost: mCost
        })
      });
      if (!res.ok) throw new Error("Failed to save maintenance");

      if (descInput) descInput.value = "";
      if (costInput) costInput.value = "";
      this.showToast(isEn ? "Maintenance record added successfully" : "บันทึกประวัติซ่อมบำรุงเรียบร้อยแล้ว", "success");
      await this.loadCarMaintenances(plate);
    } catch (err) {
      console.error("submitCarMaintenance error:", err);
      this.showToast(isEn ? "Error saving maintenance" : "เกิดข้อผิดพลาดในการบันทึก", "danger");
    }
  },

  async deleteCarMaintenance(plate, mId) {
    const isEn = (this.currentLang === "EN");
    if (!confirm(isEn ? "Are you sure you want to delete this maintenance entry?" : "ยืนยันการลบรายการซ่อมนี้ใช่หรือไม่?")) {
      return;
    }

    try {
      const res = await fetch(`/api/cars/${encodeURIComponent(plate)}/maintenances/${encodeURIComponent(mId)}`, {
        method: "DELETE"
      });
      if (!res.ok) throw new Error("Failed to delete");
      this.showToast(isEn ? "Maintenance record deleted" : "ลบรายการซ่อมบำรุงเรียบร้อยแล้ว", "success");
      await this.loadCarMaintenances(plate);
      await this.loadCars();
      try {
        if (this.loadDashboardKPIs) await this.loadDashboardKPIs();
        if (this.loadDashboardData) await this.loadDashboardData();
        if (this.renderDashboardCharts) this.renderDashboardCharts();
      } catch (dbErr) {
        console.warn("Dashboard refetch warning:", dbErr);
      }
    } catch (err) {
      console.error("deleteCarMaintenance error:", err);
      this.showToast(isEn ? "Error deleting maintenance" : "เกิดข้อผิดพลาดในการลบ", "danger");
    }
  }
});
