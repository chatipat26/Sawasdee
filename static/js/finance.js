/**
 * Sawasdee Rental - Fleet Expiries, Monthly Expenses, Renewals & Shift Closing
 * Prototype Mixin for App
 */
Object.assign(App.prototype, {
  parseExpiryDateInfo(rawStr) {
    const str = String(rawStr || "").trim();
    if (!str || str === "-" || str.toLowerCase() === "none") {
      return { valid: false, dateObj: null, daysLeft: 999999, raw: "-", formatted: "-" };
    }

    let d = null;
    if (str.includes("/")) {
      const parts = str.split("/");
      if (parts.length === 3) {
        let day = parseInt(parts[0], 10);
        let month = parseInt(parts[1], 10) - 1;
        let year = parseInt(parts[2], 10);
        if (year > 2400) year -= 543;
        if (!isNaN(day) && !isNaN(month) && !isNaN(year)) {
          d = new Date(year, month, day);
        }
      }
    } else if (str.includes("-")) {
      const parts = str.split("-");
      if (parts.length === 3) {
        let year = parseInt(parts[0], 10);
        let month = parseInt(parts[1], 10) - 1;
        let day = parseInt(parts[2], 10);
        if (year > 2400) year -= 543;
        if (!isNaN(day) && !isNaN(month) && !isNaN(year)) {
          d = new Date(year, month, day);
        }
      }
    }

    if (!d || isNaN(d.getTime())) {
      return { valid: false, dateObj: null, daysLeft: 999999, raw: str, formatted: str };
    }

    const now = new Date();
    const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const targetMidnight = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const diffDays = Math.round((targetMidnight.getTime() - todayMidnight.getTime()) / 86400000);

    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const yyyy = d.getFullYear();

    return {
      valid: true,
      dateObj: d,
      daysLeft: diffDays,
      raw: str,
      formatted: `${dd}/${mm}/${yyyy}`
    };
  },

  formatExpiryStatusCell(plate, field, rawStr) {
    const info = this.parseExpiryDateInfo(rawStr);
    const safePlate = String(plate || "").replace(/'/g, "\\'");
    const labelType = field === "tax_expiry" ? "ภาษี" : (field === "act_expiry" ? "พ.ร.บ." : "ประกันภัย");
    const mode = field === "ins_expiry" ? "ins" : "act";

    let badgeHtml = `<span style="color:#64748B; font-size:11.5px;">${info.formatted}</span>`;
    if (info.valid) {
      if (info.daysLeft < 0) {
        badgeHtml = `
          <span style="display:inline-flex; align-items:center; gap:4px; font-weight:700; color:#991B1B; background:#FEE2E2; border:1px solid #FECACA; padding:2px 8px; border-radius:12px; font-size:11.5px; white-space:nowrap;">
            🔴 ${info.formatted} (ขาด ${Math.abs(info.daysLeft)} วัน)
          </span>`;
      } else if (info.daysLeft === 0) {
        badgeHtml = `
          <span style="display:inline-flex; align-items:center; gap:4px; font-weight:700; color:#991B1B; background:#FEE2E2; border:1px solid #FECACA; padding:2px 8px; border-radius:12px; font-size:11.5px; white-space:nowrap;">
            🔴 ${info.formatted} (วันนี้!)
          </span>`;
      } else if (info.daysLeft <= 30) {
        badgeHtml = `
          <span style="display:inline-flex; align-items:center; gap:4px; font-weight:700; color:#B45309; background:#FEF3C7; border:1px solid #FDE68A; padding:2px 8px; border-radius:12px; font-size:11.5px; white-space:nowrap;">
            🟡 ${info.formatted} (เหลือ ${info.daysLeft} วัน)
          </span>`;
      } else {
        badgeHtml = `
          <span style="display:inline-flex; align-items:center; gap:4px; font-weight:600; color:#065F46; background:#ECFDF5; border:1px solid #A7F3D0; padding:2px 8px; border-radius:12px; font-size:11.5px; white-space:nowrap;">
            🟢 ${info.formatted}
          </span>`;
      }
    }

    // Check if an active renewal or maintenance job exists for this car & field
    const activeMnt = (this.maintenanceRecords || []).find(m =>
      m.car_id === plate &&
      m.status !== "เสร็จสิ้น" &&
      m.status !== "ยกเลิก" &&
      (
        ((field === "act_expiry" || field === "tax_expiry") && (String(m.order_type).includes("พ.ร.บ.") || String(m.order_type).includes("ต่อทะเบียน") || String(m.order_type).includes("แพ็กคู่"))) ||
        (field === "ins_expiry" && (String(m.order_type).includes("ประกัน") || String(m.order_type).includes("แพ็กคู่")))
      )
    );

    let actionBtnHtml = '';
    if (activeMnt) {
      actionBtnHtml = `
        <div style="display:inline-flex; align-items:center; gap:4px;">
          <button type="button" onclick="app.openCloseMaintenanceModal('${activeMnt.id}')" title="พนักงานต่อเสร็จแล้ว: คลิกเพื่อระบุวันหมดอายุใหม่ & ส่งงาน" style="background:#ECFDF5; color:#047857; border:1px solid #10B981; border-radius:6px; padding:2px 7px; font-size:11px; font-weight:800; cursor:pointer; display:inline-flex; align-items:center; gap:2px;">
            🏁 ส่งงาน
          </button>
        </div>
      `;
    } else if (field === "tax_expiry") {
      actionBtnHtml = `
        <div style="display:inline-flex; align-items:center; gap:3px;">
          <button type="button" onclick="app.openExpiryModal('${safePlate}', 'tax_expiry')" title="ระบุ/แก้ไขวันหมดอายุภาษีโดยตรง" style="background:#F8FAFC; color:#64748B; border:1px solid #CBD5E1; border-radius:6px; padding:2px 5px; font-size:11px; cursor:pointer;">
            ✏️
          </button>
        </div>
      `;
    } else {
      actionBtnHtml = `
        <div style="display:inline-flex; align-items:center; gap:3px;">
          <button type="button" onclick="app.openRenewalOrderModal('${safePlate}', '${mode}')" title="ออกใบงานมอบหมายต่ออายุ ${labelType} (ขึ้นหน้าตารางงาน)" style="background:#FFF7ED; color:#C2410C; border:1px solid #FDBA74; border-radius:6px; padding:2px 6px; font-size:11px; font-weight:700; cursor:pointer; display:inline-flex; align-items:center; gap:2px;">
            📋 ออกใบงาน
          </button>
          <button type="button" onclick="app.openExpiryModal('${safePlate}', '${field}')" title="ระบุ/แก้ไขวันหมดอายุ ${labelType} โดยตรง" style="background:#F8FAFC; color:#64748B; border:1px solid #CBD5E1; border-radius:6px; padding:2px 5px; font-size:11px; cursor:pointer;">
            ✏️
          </button>
        </div>
      `;
    }

    return `
      <div style="display:flex; flex-direction:column; gap:3px;">
        <div style="display:flex; align-items:center; justify-content:space-between; gap:6px; flex-wrap:nowrap;">
          <div>${badgeHtml}</div>
          <div style="flex-shrink:0;">${actionBtnHtml}</div>
        </div>
        ${activeMnt ? `<div style="font-size:10.5px; color:#1D4ED8; font-weight:700; display:flex; align-items:center; gap:3px;"><span>⏳ มอบหมาย:</span> <span style="color:#0F172A;">${activeMnt.assigned_worker || 'ช่าง'}</span> <span style="color:#64748B;">(${activeMnt.id})</span></div>` : ''}
      </div>
    `;
  },

  renderFleetOverviewTable() {
    const tbody = document.getElementById("fleet-overview-tbody");
    if (!tbody) return;

    const isEn = (this.currentLang === "EN");
    const summaryEl = document.getElementById("dash-fleet-expiry-summary");
    const sortMode = document.getElementById("dash-fleet-sort-select")?.value || "expiry_asc";
    const localKw = (document.getElementById("dash-fleet-search-input")?.value || "").toLowerCase().trim();
    const sbKw = (this.sidebarSearchKw || "").toLowerCase().trim();

    // 1. Total Fleet across all companies (Unified Dashboard)
    const scopedCars = this.cars || [];

    let expiredCount = 0;
    let warningCount = 0;
    let normalCount = 0;

    // Duplicate check across current fleet
    const seenNormPlates = new Set();
    const seenChassis = new Set();
    let dupCount = 0;
    (this.cars || []).forEach(c => {
      const np = this.normalizePlate(c.plate);
      if (seenNormPlates.has(np)) dupCount++;
      seenNormPlates.add(np);
      const ch = String(c.chassis_no || "").trim().toUpperCase();
      if (ch && ch !== "-" && ch.length >= 8) {
        if (seenChassis.has(ch)) dupCount++;
        seenChassis.add(ch);
      }
    });

    const enrichedCars = scopedCars.map(c => {
      const taxInfo = this.parseExpiryDateInfo(c.tax_expiry);
      const actInfo = this.parseExpiryDateInfo(c.act_expiry);
      const insInfo = this.parseExpiryDateInfo(c.ins_expiry);
      const minDays = Math.min(actInfo.daysLeft, insInfo.daysLeft, taxInfo.daysLeft);
      const maxDays = Math.max(actInfo.daysLeft, insInfo.daysLeft);

      if (minDays < 0) expiredCount++;
      else if (minDays <= 30) warningCount++;
      else normalCount++;

      return {
        car: c,
        taxInfo,
        actInfo,
        insInfo,
        minDays,
        maxDays
      };
    });

    const titleEl = document.getElementById("title-expander-fleet");
    if (titleEl) {
      titleEl.textContent = isEn 
        ? `Fleet Database Overview (Tax, ACT, Ins & Service — ${scopedCars.length} cars)` 
        : `ฐานข้อมูลทะเบียนรถ, ภาษี, พ.ร.บ., ประกันภัย และเช็คระยะ (Fleet Database — ${scopedCars.length} คัน)`;
    }

    if (summaryEl) {
      summaryEl.innerHTML = `
        <span style="background:#FEE2E2; color:#991B1B; border:1px solid #FECACA; padding:3px 9px; border-radius:12px; font-size:11.5px; font-weight:700;">
          🔴 ${isEn ? `Expired: ${expiredCount} cars` : `หมดอายุ: ${expiredCount} คัน`}
        </span>
        <span style="background:#FEF3C7; color:#B45309; border:1px solid #FDE68A; padding:3px 9px; border-radius:12px; font-size:11.5px; font-weight:700;">
          🟡 ${isEn ? `Due soon (≤30d): ${warningCount} cars` : `ใกล้หมด (≤30 วัน): ${warningCount} คัน`}
        </span>
        <span style="background:#ECFDF5; color:#065F46; border:1px solid #A7F3D0; padding:3px 9px; border-radius:12px; font-size:11.5px; font-weight:700;">
          🟢 ${isEn ? `Normal: ${normalCount} cars` : `ปกติ: ${normalCount} คัน`}
        </span>
        <span style="background:#EFF6FF; color:#1E40AF; border:1px solid #BFDBFE; padding:3px 9px; border-radius:12px; font-size:11.5px; font-weight:700;" title="ตรวจสอบทะเบียนซ้ำและเลขตัวถังซ้ำอัตโนมัติ">
          ${dupCount === 0 ? (isEn ? 'No Duplicates' : 'ไม่พบรถซ้ำ') : (isEn ? `Duplicates (${dupCount})` : `พบรถซ้ำ (${dupCount})`)}
        </span>
      `;
    }

    // 2. Filter by search keyword (local search or sidebar search)
    let filtered = enrichedCars.filter(item => {
      const c = item.car;
      const target = `${c.plate || ''} ${c.brand || ''} ${c.model || ''} ${c.company || ''} ${c.owner || ''} ${c.beneficiary || ''} ${c.color || ''} ${c.chassis_no || ''} ${c.ins_company || ''} ${c.reg_year || ''} ${c.notes || ''} ${c.status || ''} ${c.tax_expiry || ''} ${c.act_expiry || ''} ${c.ins_expiry || ''} ${c.hp_contract_no || ''}`.toLowerCase();
      if (localKw && !target.includes(localKw)) return false;
      if (sbKw && !target.includes(sbKw)) return false;
      return true;
    });

    // 3. Sort according to selected sort mode
    filtered.sort((a, b) => {
      if (sortMode === "tax_asc") {
        if (a.taxInfo.daysLeft !== b.taxInfo.daysLeft) return a.taxInfo.daysLeft - b.taxInfo.daysLeft;
        return String(a.car.plate || "").localeCompare(String(b.car.plate || ""), "th");
      } else if (sortMode === "act_asc") {
        if (a.actInfo.daysLeft !== b.actInfo.daysLeft) return a.actInfo.daysLeft - b.actInfo.daysLeft;
        if (a.insInfo.daysLeft !== b.insInfo.daysLeft) return a.insInfo.daysLeft - b.insInfo.daysLeft;
        return String(a.car.plate || "").localeCompare(String(b.car.plate || ""), "th");
      } else if (sortMode === "ins_asc") {
        if (a.insInfo.daysLeft !== b.insInfo.daysLeft) return a.insInfo.daysLeft - b.insInfo.daysLeft;
        if (a.actInfo.daysLeft !== b.actInfo.daysLeft) return a.actInfo.daysLeft - b.actInfo.daysLeft;
        return String(a.car.plate || "").localeCompare(String(b.car.plate || ""), "th");
      } else if (sortMode === "plate_asc") {
        return String(a.car.plate || "").localeCompare(String(b.car.plate || ""), "th");
      } else {
        if (a.minDays !== b.minDays) return a.minDays - b.minDays;
        if (a.maxDays !== b.maxDays) return a.maxDays - b.maxDays;
        return String(a.car.plate || "").localeCompare(String(b.car.plate || ""), "th");
      }
    });

    if (filtered.length === 0) {
      tbody.innerHTML = `<tr><td colspan="11" style="text-align:center; padding:28px; color:#64748B;">${isEn ? 'No vehicles found matching the search criteria' : 'ไม่พบข้อมูลรถยนต์ที่ค้นหา'}</td></tr>`;
      return;
    }

    tbody.innerHTML = filtered.map(item => {
      const c = item.car;
      const safePlate = String(c.plate || "").replace(/'/g, "\\'");
      const rowBg = item.minDays < 0 ? "background:#FEF2F2;" : (item.minDays <= 30 ? "background:#FFFBEB;" : "");

      const activePairMnt = (this.maintenanceRecords || []).find(m =>
        m.car_id === c.plate &&
        m.status !== "เสร็จสิ้น" &&
        m.status !== "ยกเลิก" &&
        (String(m.order_type).includes("ต่อทะเบียน") || String(m.order_type).includes("ประกัน") || String(m.order_type).includes("พ.ร.บ.") || String(m.order_type).includes("แพ็กคู่"))
      );

      let renewBtnHtml = '';
      if (activePairMnt) {
        renewBtnHtml = `
          <button type="button" onclick="app.openCloseMaintenanceModal('${activePairMnt.id}')" class="btn btn-sm" style="padding:3px 7px; font-size:11px; font-weight:800; background:#ECFDF5; color:#047857; border:1px solid #10B981;" title="${isEn ? 'Renewal completed: Submit & update dates' : 'พนักงานต่อเสร็จแล้ว: ส่งงาน & อัปเดตวันหมดอายุ'}">
            ${isEn ? 'Submit Renewal' : 'ส่งงานต่ออายุ'}
          </button>
        `;
      } else {
        renewBtnHtml = `
          <button type="button" onclick="app.openRenewalOrderModal('${safePlate}', 'both')" class="btn btn-sm" style="padding:3px 7px; font-size:11px; font-weight:700; background:#FFF7ED; color:#EA580C; border:1px solid #FDBA74;" title="${isEn ? 'Create dual work order for ACT & Insurance' : 'ออกใบงานต่ออายุทั้ง พ.ร.บ. และ ประกันภัย มอบหมายพนักงาน (ขึ้นหน้าตารางงาน)'}">
            ${isEn ? 'Dual Order' : 'ต่อคู่'}
          </button>
        `;
      }

      const regYearBadge = c.reg_year && c.reg_year !== "-"
        ? `<div style="font-size:10.5px; color:#64748B;">${isEn ? 'Reg Year:' : 'ปีจด:'} <b>${c.reg_year}</b></div>`
        : "";

      const ownerTxt = c.owner && c.owner !== "-" ? c.owner : (c.company || "-");
      const benTxt = c.beneficiary && c.beneficiary !== "-" && c.beneficiary !== ownerTxt
        ? `<div style="font-size:10.5px; color:#64748B;">ผู้รับผลประโยชน์: ${c.beneficiary}</div>`
        : "";

      const insCompBadge = c.ins_company && c.ins_company !== "-"
        ? `<div style="font-size:10.5px; color:#0369A1; font-weight:700; margin-top:2px;">${c.ins_company}</div>`
        : "";

      const srvInfo = [];
      if (c.last_service_date && c.last_service_date !== "-") srvInfo.push(`ล่าสุด: ${c.last_service_date}`);
      if (c.next_service_date && c.next_service_date !== "-") srvInfo.push(`กำหนดเช็ค: ${c.next_service_date}`);
      if (c.next_service_mileage && Number(c.next_service_mileage) > 0) srvInfo.push(`ไมล์เช็ค: ${Number(c.next_service_mileage).toLocaleString()} กม.`);
      else if (c.next_service && c.next_service !== "-" && c.next_service !== c.next_service_date) srvInfo.push(`ถัดไป: ${c.next_service}`);
      const srvHtml = srvInfo.length > 0
        ? `<div style="font-size:10.5px; color:#475569;">${srvInfo.join(" | ")}</div>`
        : "";
      const srvAlert = typeof this.getCarServiceAlert === "function" ? this.getCarServiceAlert(c) : null;
      const srvBadgeHtml = srvAlert
        ? `<div style="margin-top:3px;"><span onclick="app.openNewMaintenanceModal('${safePlate}', 'ซ่อมบำรุงทั่วไป / เช็คระยะ')" style="cursor:pointer; display:inline-flex; align-items:center; gap:4px; background:${srvAlert.bg}; color:${srvAlert.color}; border:1px solid ${srvAlert.border}; padding:2px 7px; border-radius:10px; font-size:10.5px; font-weight:700;" title="คลิกเพื่อเปิดใบงานเช็กระยะ">${srvAlert.text}</span></div>`
        : "";

      const hpBadge = c.hp_contract_no
        ? `<div style="font-size:10.5px; color:#7C3AED; font-weight:700;">สัญญา: ${c.hp_contract_no}${c.hp_installment ? ` (฿${Number(c.hp_installment).toLocaleString()}/ด.)` : ''}</div>`
        : "";

      const notesShort = c.notes
        ? `<div style="font-size:11px; color:#334155; max-width:210px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${String(c.notes).replace(/"/g, '&quot;')}">${c.notes}</div>`
        : `<span style="color:#94A3B8; font-size:11px;">-</span>`;

      return `
        <tr style="${rowBg} transition: background 0.25s ease;">
          <td style="white-space:nowrap;">
            <b>${c.plate}</b>
            ${regYearBadge}
          </td>
          <td>
            <b>${c.brand || ''}</b> ${c.model || ''}
            <div style="font-size:11px; color:#64748B;">${c.color || '-'}</div>
          </td>
          <td style="font-family:monospace; font-size:11.5px; color:#1E293B; white-space:nowrap;">${c.chassis_no || '-'}</td>
          <td>
            <div style="font-weight:700; font-size:12px; color:#1E293B;">${ownerTxt}</div>
            ${benTxt}
          </td>
          <td>
            <span class="badge" style="background:${c.status_bg}; color:${c.status_color}; border:1px solid ${c.status_border};">
              ${c.fleet_status_desc || c.status}
            </span>
          </td>
          <td>${this.formatExpiryStatusCell(c.plate, 'tax_expiry', c.tax_expiry)}</td>
          <td>${this.formatExpiryStatusCell(c.plate, 'act_expiry', c.act_expiry)}</td>
          <td>
            ${this.formatExpiryStatusCell(c.plate, 'ins_expiry', c.ins_expiry)}
            ${insCompBadge}
          </td>
          <td style="white-space:nowrap;">
            <div style="font-weight:700; font-size:12px;">${c.mileage || '15,000'} km</div>
            ${srvHtml}
            ${srvBadgeHtml}
          </td>
          <td>
            ${hpBadge}
            ${notesShort}
          </td>
          <td style="text-align:center; white-space:nowrap;">
            ${renewBtnHtml}
            <button type="button" onclick="app.openEditCarModal('${safePlate}')" class="btn btn-sm btn-secondary" style="padding:3px 7px; font-size:11.5px;" title="แก้ไขรายละเอียดรถและรูปรถ">
              ✏️
            </button>
            <button type="button" onclick="app.jumpToCarInFrontOffice('${safePlate}')" class="btn btn-sm btn-secondary" style="padding:3px 7px; font-size:11.5px;" title="ดูรถในหน้าเลือกรถยนต์">
              🔍
            </button>
            <button type="button" onclick="app.deleteCarByPlate('${safePlate}')" class="btn btn-sm" style="padding:3px 7px; font-size:11.5px; background:#FEE2E2; color:#B91C1C; border:1px solid #FCA5A5;" title="ลบรถยนต์คันนี้ออกจากระบบ">
              🗑️
            </button>
          </td>
        </tr>
      `;
    }).join("");
  },

  async loadHpLeasingData() {
    await this.loadMonthlyExpenses();
  },

  renderHpLeasingTable() {
    this.renderMonthlyExpensesTable();
  },

  getExpiryCycleInfo(dateObj = null) {
    const d = dateObj || new Date();
    const day = d.getDate();
    const curYear = d.getFullYear();
    const curMonth = d.getMonth() + 1; // 1..12

    // สัปดาห์ปัจจุบัน (Monday ถึง Sunday) สำหรับ Weekly Warning
    const curr = new Date(d);
    const dayOfWeek = (curr.getDay() + 6) % 7; // 0=Mon, 6=Sun
    const monday = new Date(curr);
    monday.setDate(curr.getDate() - dayOfWeek);
    monday.setHours(0, 0, 0, 0);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    sunday.setHours(23, 59, 59, 999);

    let roundDay, targetYear, targetMonth, roundName, roundNameEn, badgeText, badgeTextEn;
    if (day < 16) {
      roundDay = 1;
      targetYear = curYear;
      targetMonth = curMonth;
      const mm = String(targetMonth).padStart(2, '0');
      badgeText = `รอบวันที่ 1 (เดือนนี้ ${mm}/${targetYear})`;
      badgeTextEn = `Round 1st (This Month ${mm}/${targetYear})`;
      roundName = `รอบวันที่ 1 (หมดอายุเดือนนี้ ${mm}/${targetYear})`;
      roundNameEn = `Round 1st (Expiring this month ${mm}/${targetYear})`;
    } else {
      roundDay = 16;
      // Year-end safe transition: December (12) -> January (1) of next year
      if (curMonth === 12) {
        targetYear = curYear + 1;
        targetMonth = 1;
      } else {
        targetYear = curYear;
        targetMonth = curMonth + 1;
      }
      const mm = String(targetMonth).padStart(2, '0');
      badgeText = `รอบวันที่ 16 (เดือนหน้า ${mm}/${targetYear})`;
      badgeTextEn = `Round 16th (Next Month ${mm}/${targetYear})`;
      roundName = `รอบวันที่ 16 (หมดอายุเดือนหน้า ${mm}/${targetYear})`;
      roundNameEn = `Round 16th (Expiring next month ${mm}/${targetYear})`;
    }

    const targetYM = `${targetYear}-${String(targetMonth).padStart(2, '0')}`;
    return {
      roundDay,
      targetYear,
      targetMonth,
      targetYM,
      roundName,
      roundNameEn,
      badgeText,
      badgeTextEn,
      weekStart: monday,
      weekEnd: sunday
    };
  },

  onAlertBannerClick() {
    const cycle = this.getExpiryCycleInfo();
    const body = document.getElementById("body-expander-monthly-expenses");
    const header = document.querySelector("#expander-monthly-expenses .expander-header");
    if (body) body.style.display = "block";
    if (header) header.classList.add("open");

    this.currentCycleFilterYM = cycle.targetYM;
    this.renderMonthlyExpensesTable();

    const el = document.getElementById("expander-monthly-expenses");
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    this.showToast(`🔍 เลื่อนไปที่ตารางสรุปค่าใช้จ่าย: ${cycle.roundName}`, "info");
  },

  jumpToFilteredExpensesTable() {
    this.closeModal("modal-cycle-expiries");
    this.onAlertBannerClick();
  },

  clearCycleFilter() {
    this.currentCycleFilterYM = null;
    this.renderMonthlyExpensesTable();
    this.showToast("ล้างตัวกรองรอบแจ้งเตือนแล้ว (แสดงทุกรายการ)", "info");
  },

  showExpiryCycleDetails() {
    const cycle = this.getExpiryCycleInfo();
    const data = this.monthlyExpensesData || {};
    const allExpenses = data.expenses || [];
    const isEn = (this.currentLang === "EN");

    const matched = allExpenses.filter(item => {
      const iso = String(item.due_date_iso || "");
      const isMatchYM = iso.startsWith(cycle.targetYM);
      const isOverdueInRound1 = (cycle.roundDay === 1 && item.status_key === "overdue");
      let isWeekly = false;
      if (iso && cycle.weekStart && cycle.weekEnd) {
        try {
          const itemDate = new Date(iso);
          isWeekly = (itemDate >= cycle.weekStart && itemDate <= cycle.weekEnd);
        } catch (e) {}
      }
      return isMatchYM || isOverdueInRound1 || isWeekly;
    });

    const titleEl = document.getElementById("modal-cycle-title");
    if (titleEl) titleEl.textContent = isEn ? `Expiring Documents & Expenses (${cycle.roundNameEn})` : `รายการเอกสารที่ต้องต่ออายุ — ${cycle.roundName}`;

    const subEl = document.getElementById("modal-cycle-subtitle");
    if (subEl) subEl.textContent = isEn 
      ? `Cycle Round: ${cycle.roundDay}th of month | Target month: ${cycle.targetYM}`
      : `รอบการแจ้งเตือนวันที่ ${cycle.roundDay} ของเดือน | เดือนเป้าหมาย: ${cycle.targetYM}`;

    const summaryEl = document.getElementById("modal-cycle-summary-bar");
    const totalAmt = matched.reduce((sum, it) => sum + parseFloat(it.amount || 0), 0);
    if (summaryEl) {
      summaryEl.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
          <div>
            <b>${isEn ? 'Cycle Round:' : 'รอบแจ้งเตือน:'}</b> <span style="font-weight:800; color:#EA580C;">${isEn ? cycle.roundNameEn : cycle.roundName}</span>
          </div>
          <div>
            <b>${isEn ? 'Total Items:' : 'รวมทั้งหมด:'}</b> <span style="font-weight:800;">${matched.length} ${isEn ? 'items' : 'รายการ'}</span>
          </div>
          <div>
            <b>${isEn ? 'Total Amount:' : 'ยอดเงินรวม:'}</b> <span style="font-weight:800; color:#15803D;">฿${totalAmt.toLocaleString('th-TH', {minimumFractionDigits: 2})}</span>
          </div>
        </div>
      `;
    }

    const tbody = document.getElementById("modal-cycle-tbody");
    if (tbody) {
      if (matched.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:32px; color:#64748B;">🎉 ${isEn ? 'No documents expiring in this cycle.' : `ไม่มีเอกสารหรือค่าใช้จ่ายครบกำหนดใน ${cycle.roundName}`}</td></tr>`;
      } else {
        tbody.innerHTML = matched.map((it, idx) => {
          let badgeClass = "badge badge-success";
          let itStatus = it.status;
          if (it.status_key === "overdue" || it.days_left < 0) {
            badgeClass = "badge badge-danger";
            itStatus = isEn ? "Overdue" : "เกินกำหนด";
          } else if (it.status_key === "pending_near" || (it.status_key !== "paid" && it.days_left <= 15)) {
            badgeClass = "badge badge-warning";
            itStatus = isEn ? "Pending (Due Soon)" : "รอชำระ (ใกล้ครบกำหนด)";
          } else if (it.status_key === "pending" || (it.status_key !== "paid" && it.days_left <= 30)) {
            badgeClass = "badge badge-warning";
            itStatus = isEn ? "Pending" : "รอชำระ";
          } else {
            itStatus = isEn ? "Paid" : "ชำระแล้ว";
          }
          return `
            <tr style="background:#ffffff !important;">
              <td style="text-align:center; font-weight:700; color:#64748B; background:#ffffff !important;">${idx + 1}</td>
              <td style="background:#ffffff !important;"><b>${it.plate}</b><br/><small style="color:#64748B;">${it.model}</small></td>
              <td style="background:#ffffff !important;"><b>${it.expense_type}</b></td>
              <td style="text-align:center; font-weight:600; background:#ffffff !important;">${it.due_date || '-'}<br/><small style="color:${it.days_left < 0 ? '#DC2626' : '#64748B'};">${it.notes || ''}</small></td>
              <td style="text-align:right; font-weight:800; color:#0F172A; background:#ffffff !important;">฿${Number(it.amount || 0).toLocaleString('th-TH', {minimumFractionDigits: 2})}</td>
              <td style="text-align:center; background:#ffffff !important;"><span class="${badgeClass}">${itStatus}</span></td>
            </tr>
          `;
        }).join("");
      }
    }

    this.openModal("modal-cycle-expiries");
  },

  openTopExpensesModal() {
    const isEn = (this.currentLang === "EN");
    const data = this.monthlyExpensesData || {};
    const allExpenses = data.expenses || [];

    // Map: plate -> { plate, model, company, total, breakdown: [] }
    const carMap = {};

    // 1. Populate all registered cars
    (this.cars || []).forEach(c => {
      const pl = c.id || c.plate;
      if (!pl) return;
      carMap[pl] = {
        plate: pl,
        model: `${c.brand || ''} ${c.model || ''}`.trim() || '-',
        company: c.company || c.owner_company || '-',
        total: 0,
        breakdown: []
      };
    });

    // 2. Aggregate expenses for each car (ภาษี + พ.ร.บ. + ประกัน + ค่างวด)
    allExpenses.forEach(exp => {
      const pl = exp.plate;
      if (!pl) return;
      if (!carMap[pl]) {
        carMap[pl] = {
          plate: pl,
          model: exp.model || '-',
          company: exp.company || '-',
          total: 0,
          breakdown: []
        };
      }
      const amt = parseFloat(exp.amount || 0);
      carMap[pl].total += amt;
      carMap[pl].breakdown.push({
        type: exp.expense_type,
        amount: amt
      });
    });

    // 3. Convert to array and sort descending by total expenses
    const rankedCars = Object.values(carMap);
    rankedCars.sort((a, b) => b.total - a.total);

    const grandTotal = rankedCars.reduce((sum, c) => sum + c.total, 0);

    // 4. Populate Summary Ribbon
    const summaryEl = document.getElementById("modal-top-expenses-summary");
    if (summaryEl) {
      summaryEl.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
          <div>
            <b>${isEn ? 'Total Vehicles:' : 'จำนวนรถทั้งหมด:'}</b> <span style="font-weight:800; color:#991B1B;">${rankedCars.length} ${isEn ? 'cars' : 'คัน'}</span>
          </div>
          <div>
            <b>${isEn ? 'Highest Expense Car:' : 'รถที่มีค่าใช้จ่ายสูงสุด:'}</b> <span style="font-weight:800; color:#DC2626;">${rankedCars[0] ? `${rankedCars[0].plate} (฿${rankedCars[0].total.toLocaleString('th-TH', {minimumFractionDigits: 2})})` : '-'}</span>
          </div>
          <div>
            <b>${isEn ? 'Total Fleet Expenses:' : 'ยอดค่าใช้จ่ายรวมทุกคัน:'}</b> <span style="font-weight:800; color:#991B1B;">฿${grandTotal.toLocaleString('th-TH', {minimumFractionDigits: 2})}</span>
          </div>
        </div>
      `;
    }

    // 5. Populate Table Body
    const tbody = document.getElementById("modal-top-expenses-tbody");
    if (tbody) {
      if (rankedCars.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:32px; color:#64748B;">${isEn ? 'No vehicle expense data found.' : 'ไม่พบข้อมูลค่าใช้จ่ายรถยนต์'}</td></tr>`;
      } else {
        tbody.innerHTML = rankedCars.map((c, idx) => {
          const rankBadge = idx === 0 
            ? '<span style="font-size:16px;">🥇</span>' 
            : (idx === 1 ? '<span style="font-size:16px;">🥈</span>' : (idx === 2 ? '<span style="font-size:16px;">🥉</span>' : `<span style="font-weight:700; color:#64748B;">#${idx + 1}</span>`));
          const bdText = c.breakdown.length > 0 
            ? c.breakdown.map(b => `<span style="display:inline-block; background:#F8FAFC; border:1px solid #E2E8F0; border-radius:6px; padding:1px 6px; margin:2px;">${b.type}: ฿${Number(b.amount).toLocaleString()}</span>`).join(" ")
            : '<span style="color:#94A3B8;">ไม่มีรายการค้างชำระ</span>';

          return `
            <tr style="background:#ffffff !important;">
              <td style="text-align:center; font-size:14px; background:#ffffff !important;">${rankBadge}</td>
              <td style="background:#ffffff !important;"><b style="font-size:13.5px; color:#0F172A;">${c.plate}</b></td>
              <td style="background:#ffffff !important;"><span style="font-weight:600; color:#334155;">${c.model}</span></td>
              <td style="font-size:11.5px; color:#64748B; background:#ffffff !important;">${bdText}</td>
              <td style="text-align:right; font-weight:800; color:#DC2626; font-size:13.5px; background:#ffffff !important;">฿${c.total.toLocaleString('th-TH', {minimumFractionDigits: 2})}</td>
            </tr>
          `;
        }).join("");
      }
    }

    this.openModal("modal-top-expenses");
  },

  async loadMonthlyExpenses() {
    try {
      const res = await fetch(`/api/expenses/monthly?_t=${Date.now()}`, {
        cache: "no-store",
        headers: { "Cache-Control": "no-cache", "Pragma": "no-cache" }
      });
      if (res.ok) {
        this.monthlyExpensesData = await res.json();
        this.renderMonthlyExpensesTable();
      }
    } catch (e) {
      console.error("loadMonthlyExpenses error:", e);
    }
  },

  renderMonthlyExpensesTable() {
    const data = this.monthlyExpensesData || {};
    const summary = data.summary || {};
    const allExpenses = data.expenses || [];
    const isEn = (this.currentLang === "EN");

    // 1. Render Top Summary Badges Strip
    const cardsEl = document.getElementById("monthly-expenses-summary-cards");
    if (cardsEl) {
      cardsEl.innerHTML = `
        <div style="background:#FEF2F2; border:1px solid #FECACA; border-radius:10px; padding:10px 12px;">
          <div style="font-size:11.5px; color:#991B1B; font-weight:700;">📑 ${isEn ? 'Tax Pending' : 'ภาษีประจำปีรอชำระ'}</div>
          <div style="font-size:18px; font-weight:800; color:#DC2626; margin-top:2px;">${summary.tax_pending || 0} ${isEn ? 'items' : 'คัน'}</div>
        </div>
        <div style="background:#FFFBEB; border:1px solid #FDE68A; border-radius:10px; padding:10px 12px;">
          <div style="font-size:11.5px; color:#92400E; font-weight:700;">🛡️ ${isEn ? 'ACT / PRB Pending' : 'พ.ร.บ. รอชำระ'}</div>
          <div style="font-size:18px; font-weight:800; color:#D97706; margin-top:2px;">${summary.act_pending || 0} ${isEn ? 'items' : 'คัน'}</div>
        </div>
        <div style="background:#EFF6FF; border:1px solid #BFDBFE; border-radius:10px; padding:10px 12px;">
          <div style="font-size:11.5px; color:#1E40AF; font-weight:700;">🚗 ${isEn ? 'Insurance Pending' : 'ประกันภัยรอชำระ'}</div>
          <div style="font-size:18px; font-weight:800; color:#2563EB; margin-top:2px;">${summary.insurance_pending || 0} ${isEn ? 'items' : 'คัน'}</div>
        </div>
        <div style="background:#FFF7ED; border:1px solid #FED7AA; border-radius:10px; padding:10px 12px;">
          <div style="font-size:11.5px; color:#C2410C; font-weight:700;">💳 ${isEn ? 'Installments Pending' : 'ค่างวดผ่อนรถรอชำระ'}</div>
          <div style="font-size:18px; font-weight:800; color:#EA580C; margin-top:2px;">${summary.installment_pending || 0} ${isEn ? 'items' : 'คัน'}</div>
        </div>
        <div style="background:#F0FDF4; border:1px solid #BBF7D0; border-radius:10px; padding:10px 12px;">
          <div style="font-size:11.5px; color:#166534; font-weight:700;">💰 ${isEn ? 'Total Pending Amount' : 'ยอดรวมที่ต้องชำระรอบนี้'}</div>
          <div style="font-size:18px; font-weight:800; color:#15803D; margin-top:2px;">฿${Number(summary.total_pending_amount || 0).toLocaleString('th-TH', {minimumFractionDigits: 2})}</div>
        </div>
      `;
    }

    // Update alert count badge on dashboard
    const cycle = this.getExpiryCycleInfo();
    const cycleMatched = allExpenses.filter(item => {
      const iso = String(item.due_date_iso || "");
      const isMatchYM = iso.startsWith(cycle.targetYM);
      const isOverdueInRound1 = (cycle.roundDay === 1 && item.status_key === "overdue");
      let isWeekly = false;
      if (iso && cycle.weekStart && cycle.weekEnd) {
        try {
          const itemDate = new Date(iso);
          isWeekly = (itemDate >= cycle.weekStart && itemDate <= cycle.weekEnd);
        } catch (e) {}
      }
      return isMatchYM || isOverdueInRound1 || isWeekly;
    });
    const alertCountEl = document.getElementById("dash-alert-count");
    if (alertCountEl) alertCountEl.textContent = cycleMatched.length;

    // Optional active cycle notice banner above table
    let cycleNoticeEl = document.getElementById("monthly-expenses-cycle-notice");
    if (!cycleNoticeEl && cardsEl) {
      cycleNoticeEl = document.createElement("div");
      cycleNoticeEl.id = "monthly-expenses-cycle-notice";
      cardsEl.parentNode.insertBefore(cycleNoticeEl, cardsEl.nextSibling);
    }
    if (this.currentCycleFilterYM && cycleNoticeEl) {
      cycleNoticeEl.style.display = "block";
      cycleNoticeEl.innerHTML = `
        <div style="background:#FFF7ED; border:1px solid #FDBA74; border-radius:8px; padding:8px 14px; margin-bottom:12px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
          <div style="font-size:12.5px; color:#C2410C; font-weight:700;">
            🔍 ${isEn ? 'Showing only items for:' : 'กำลังแสดงรายการเฉพาะ:'} <span>${cycle.roundName}</span> (${cycleMatched.length} ${isEn ? 'items' : 'รายการ'})
          </div>
          <button type="button" class="btn btn-sm btn-secondary" onclick="app.clearCycleFilter()" style="padding:3px 10px; font-size:11.5px; font-weight:700;">
            ✕ ${isEn ? 'Clear Filter (Show All)' : 'ล้างตัวกรองรอบนี้ (แสดงทั้งหมด)'}
          </button>
        </div>
      `;
    } else if (cycleNoticeEl) {
      cycleNoticeEl.style.display = "none";
    }

    // 2. Filter Table Items
    const kw = (document.getElementById("expense-search-kw")?.value || "").toLowerCase().trim();
    const typeFilter = document.getElementById("expense-type-filter")?.value || "ทั้งหมด";
    const statusFilter = document.getElementById("expense-status-filter")?.value || "ทั้งหมด";

    const filtered = allExpenses.filter(item => {
      if (this.currentCycleFilterYM) {
        const iso = String(item.due_date_iso || "");
        const isMatchYM = iso.startsWith(this.currentCycleFilterYM);
        const isOverdueInRound1 = (cycle.roundDay === 1 && item.status_key === "overdue");
        if (!isMatchYM && !isOverdueInRound1) return false;
      }
      if (kw) {
        const fullTxt = `${item.plate} ${item.model} ${item.company} ${item.expense_type}`.toLowerCase();
        if (!fullTxt.includes(kw)) return false;
      }
      if (typeFilter !== "ทั้งหมด") {
        if (!item.expense_type.includes(typeFilter) && item.expense_key !== typeFilter) return false;
      }
      if (statusFilter !== "ทั้งหมด") {
        if (statusFilter === "รอชำระ" && item.status_key === "paid") return false;
        if (statusFilter === "ชำระแล้ว" && item.status_key !== "paid") return false;
      }
      return true;
    });

    // 3. Render Table Body
    const tbody = document.getElementById("monthly-expenses-tbody");
    if (!tbody) return;

    if (filtered.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:36px; color:#64748B;">${isEn ? 'No expense items found matching the selected filters.' : '🎉 ไม่มีรายการค่าใช้จ่ายค้างชำระตามตัวกรองที่เลือก'}</td></tr>`;
      return;
    }

    tbody.innerHTML = filtered.map((item, idx) => {
      let badgeStyle = "background:#ECFDF5; color:#065F46; border:1px solid #A7F3D0; font-weight:700;";
      let badgeIcon = "✅";
      let displayStatus = item.status;

      // SINGLE SOURCE OF TRUTH: Directly reflect Backend status & status_key
      if (item.status_key === "paid") {
        badgeStyle = "background:#ECFDF5; color:#065F46; border:1px solid #A7F3D0; font-weight:700;";
        badgeIcon = "✅";
        displayStatus = item.status || (isEn ? "Paid" : "ชำระแล้ว");
      } else if (item.status_key === "overdue") {
        badgeStyle = "background:#FEF2F2; color:#991B1B; border:1px solid #FECACA; font-weight:800;";
        badgeIcon = "⚠️";
        displayStatus = item.status || (isEn ? "Overdue" : "เกินกำหนด");
      } else if (item.status_key === "pending_near") {
        badgeStyle = "background:#FFF7ED; color:#C2410C; border:1.5px solid #FDBA74; font-weight:800;";
        badgeIcon = "⏳";
        displayStatus = item.status || (isEn ? "Pending (Due Soon)" : "รอชำระ (ใกล้ครบกำหนด)");
      } else {
        badgeStyle = "background:#FFFBEB; color:#92400E; border:1px solid #FDE68A; font-weight:700;";
        badgeIcon = "⏳";
        displayStatus = item.status || (isEn ? "Pending" : "รอชำระ");
      }

      const safePlate = String(item.plate || "").replace(/'/g, "\\'");
      const isPaid = (item.status_key === "paid");

      return `
        <tr>
          <td style="text-align:center; font-weight:700; color:#64748B;">${idx + 1}</td>
          <td>
            <div style="font-weight:800; color:#1E293B;">🚘 ${item.plate}</div>
            <div style="font-size:12px; color:#475569;">${item.model} <span style="font-size:11px; color:#94A3B8;">(${item.company})</span></div>
          </td>
          <td>
            <span style="font-weight:700; color:#334155; font-size:12px;">${item.expense_type}</span>
          </td>
          <td style="text-align:center;">
            <div style="font-weight:700; color:#1E293B;">📅 ${item.due_date}</div>
            <div style="font-size:11px; color:${item.days_left < 0 ? '#DC2626' : (item.days_left <= 15 ? '#C2410C' : (item.days_left <= 30 ? '#D97706' : '#16A34A'))}; font-weight:600;">
              ${item.notes}
            </div>
          </td>
          <td style="text-align:right; font-weight:800; color:#1E293B; font-size:13px;">
            ฿${Number(item.amount || 0).toLocaleString('th-TH', {minimumFractionDigits: 2})}
          </td>
          <td style="text-align:center;">
            <span style="font-size:11.5px; padding:3px 10px; border-radius:12px; display:inline-block; ${badgeStyle}">
              ${badgeIcon} ${displayStatus}
            </span>
          </td>
          <td style="text-align:center;">
            <button type="button" class="btn btn-sm ${isPaid ? 'btn-secondary' : 'btn-primary'}" onclick="app.payMonthlyExpense('${safePlate}', '${item.expense_key}', ${item.amount || 0}, '${item.due_date}')" style="padding:4px 12px; font-size:11.5px; font-weight:700; border-radius:6px; cursor:pointer;" title="${isEn ? 'Mark as Paid & Extend Expiry Date' : 'บันทึกชำระเงินและต่ออายุวันหมดอายุอัตโนมัติ'}">
              💳 ${isEn ? 'Update Paid' : 'อัปเดตชำระเงิน'}
            </button>
          </td>
        </tr>
      `;
    }).join("");
  },

  async payMonthlyExpense(plate, expenseKey, amount = 0, dueDate = "") {
    if (!plate || !expenseKey) return;
    const isEn = (this.currentLang === "EN");
    const typeLabel = expenseKey === "tax" ? "ภาษีประจำปี" : (expenseKey === "act" ? "พ.ร.บ." : (expenseKey === "insurance" ? "ประกันภัย" : "ค่างวดผ่อนรถ"));
    const conf = confirm(`ยืนยันการบันทึกชำระเงิน "${typeLabel}" สำหรับรถทะเบียน ${plate} หรือไม่?

💰 ยอดเงิน: ฿${Number(amount || 0).toLocaleString('th-TH', {minimumFractionDigits: 2})}
💡 ระบบจะทำการบันทึกลงบัญชีรายจ่าย (financial_records) และต่ออายุรอบถัดไปให้อัตโนมัติ`);
    if (!conf) return;

    try {
      const todayIso = new Date().toISOString().split("T")[0];
      const res = await fetch("/api/expenses/pay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plate: plate,
          car_id: plate,
          expense_type: expenseKey,
          amount: Number(amount || 0),
          payment_date: todayIso,
          due_date: dueDate
        })
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || data.error || "เกิดข้อผิดพลาดในการอัปเดต");
      }
      this.showToast(`🎉 ${data.message} (กำหนดใหม่: ${data.new_due_date})`, "success");
      // TARGET MISSION 3: Real-time UI Refresh
      await this.loadMonthlyExpenses();
      await this.loadCars();
      if (this.loadDashboardKPIs) await this.loadDashboardKPIs();
      if (this.loadFinanceSummary) await this.loadFinanceSummary();
    } catch (e) {
      alert(`❌ อัปเดตชำระเงินไม่สำเร็จ:
${e.message}`);
      this.showToast("เกิดข้อผิดพลาด: " + e.message, "danger");
    }
  },

  computeRenewedDateStr(rawStr) {
    const now = new Date();
    const info = this.parseExpiryDateInfo(rawStr);
    let targetDate = null;

    if (info.valid && info.dateObj) {
      const d = info.dateObj;
      let targetYear = Math.max(d.getFullYear() + 1, now.getFullYear() + 1);
      targetDate = new Date(targetYear, d.getMonth(), d.getDate());
      const diffDays = Math.round((targetDate.getTime() - now.getTime()) / 86400000);
      if (diffDays <= 30) {
        targetDate = new Date(targetYear + 1, d.getMonth(), d.getDate());
      }
    } else {
      targetDate = new Date(now.getFullYear() + 1, now.getMonth(), now.getDate());
    }

    const dd = String(targetDate.getDate()).padStart(2, "0");
    const mm = String(targetDate.getMonth() + 1).padStart(2, "0");
    const yyyy = targetDate.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
  },

  dmyToYmd(dmyStr) {
    if (!dmyStr || dmyStr === "-" || String(dmyStr).trim().toLowerCase() === "none") return "";
    const s = String(dmyStr).trim();
    if (s.includes("-")) {
      const parts = s.split("-");
      if (parts[0].length === 4) {
        let yr = parseInt(parts[0], 10);
        if (yr > 2400) yr -= 543;
        return `${yr}-${parts[1].padStart(2, "0")}-${parts[2].padStart(2, "0")}`;
      }
      if (parts[2].length === 4) {
        let yr = parseInt(parts[2], 10);
        if (yr > 2400) yr -= 543;
        return `${yr}-${parts[1].padStart(2, "0")}-${parts[0].padStart(2, "0")}`;
      }
    }
    if (s.includes("/")) {
      const parts = s.split("/");
      if (parts.length === 3 && parts[2].length === 4) {
        let yr = parseInt(parts[2], 10);
        if (yr > 2400) yr -= 543;
        return `${yr}-${parts[1].padStart(2, "0")}-${parts[0].padStart(2, "0")}`;
      }
    }
    return "";
  },

  ymdToDmy(ymdStr) {
    if (!ymdStr || ymdStr === "-") return "";
    const s = String(ymdStr).trim();
    if (s.includes("-")) {
      const parts = s.split("-");
      if (parts.length === 3 && parts[0].length === 4) {
        return `${parts[2].padStart(2, "0")}/${parts[1].padStart(2, "0")}/${parts[0]}`;
      }
    }
    return s;
  },

  openRenewalOrderModal(plate, mode = "both") {
    try {
      const car = (this.cars || []).find(c => c.plate === plate);
      if (!car) {
        this.showToast("ไม่พบข้อมูลรถยนต์ " + plate, "danger");
        return;
      }

      const modalTitleEl = document.getElementById("modal-mnt-title");
      if (modalTitleEl) {
        modalTitleEl.textContent = "📋 ออกใบงานมอบหมายต่อทะเบียนภาษี / พ.ร.บ. / ประกันภัย";
      }

      // 1. Populate car select in modal and select target plate
      const carSel = document.getElementById("mnt-car-select");
      if (carSel) {
        const opts = (this.cars || []).map(c => `<option value="${c.plate}">${c.plate} - ${c.brand || ''} ${c.model || ''} (${c.color || ''}) [${c.status}]</option>`);
        carSel.innerHTML = opts.join("");
        carSel.value = plate;
      }

      // 2. Populate worker select
      const workerSel = document.getElementById("mnt-assigned-worker");
      if (workerSel) {
        const userList = (this.users || []).filter(u => u.status === "approved" || !u.status);
        const opts = userList.length > 0
          ? userList.map(u => `<option value="${u.username}">${u.username} (${u.name || u.username}) [${u.role || 'Staff'}]</option>`)
          : [
              '<option value="admin">admin (ผู้ดูแลระบบ (Admin)) [Admin]</option>',
              '<option value="chaiwat.u">chaiwat.u [Staff]</option>',
              '<option value="sam">sam [Staff]</option>',
              '<option value="sucheeda">sucheeda [Staff]</option>',
              '<option value="Chatipat">Chatipat [Staff]</option>'
            ];
        workerSel.innerHTML = opts.join("");
        if (this.user?.username && Array.from(workerSel.options).some(o => o.value === this.user.username)) {
          workerSel.value = this.user.username;
        }
      }

      // 3. Update car details pill & mileage
      this.onMaintenanceCarSelected(plate);

      // 4. Set order type and service description
      let orderType = "ต่อทะเบียนภาษี และ พ.ร.บ.";
      let serviceDesc = "";
      let garageName = "สำนักงานขนส่งกรุงเทพมหานครพื้นที่ 5 (จตุจักร)";
      let garagePhone = "02-271-8888";
      let garageLoc = "กรมการขนส่งทางบก จตุจักร กทม.";
      let costEst = 1500;

      if (mode === "act") {
        orderType = "ต่อทะเบียนภาษี และ พ.ร.บ.";
        serviceDesc = `1. ตรวจสอบเอกสาร และ ชำระภาษีรถยนต์ประจำปี\n2. ต่ออายุ พ.ร.บ. คุ้มครองผู้ประสบภัยจากรถ (วันหมดอายุเดิม: ${car.act_expiry || '-'})\n3. รับป้ายวงกลมแสดงการเสียภาษีและสำเนากรมธรรม์ พ.ร.บ.`;
        garageName = "สำนักงานขนส่งกรุงเทพมหานครพื้นที่ 5 (จตุจักร)";
        garagePhone = "02-271-8888";
        garageLoc = "กรมการขนส่งทางบก จตุจักร กทม.";
        costEst = 1500;
      } else if (mode === "ins") {
        orderType = "ต่อประกันภัยรถยนต์";
        serviceDesc = `1. ต่ออายุกรมธรรม์ประกันภัยรถยนต์ประจำปี (วันหมดอายุเดิม: ${car.ins_expiry || '-'})\n2. ดำเนินการออกกรมธรรม์ความคุ้มครองฉบับใหม่ พร้อมขอใบเสร็จรับเงิน`;
        garageName = "บริษัทประกันภัยรถยนต์ (ตามกรมธรรม์เดิม)";
        garagePhone = "02-123-4567";
        garageLoc = "สำนักงานใหญ่ / ตัวแทนประกันภัย";
        costEst = 15000;
      } else {
        orderType = "ต่อทะเบียนภาษี พ.ร.บ. และ ประกันภัย (แพ็กคู่)";
        serviceDesc = `1. ชำระภาษีรถยนต์ประจำปี + ต่ออายุ พ.ร.บ. (วันหมดอายุเดิม: ${car.act_expiry || '-'})\n2. ต่ออายุกรมธรรม์ประกันภัยรถยนต์ประจำปี (วันหมดอายุเดิม: ${car.ins_expiry || '-'})\n3. รับป้ายวงกลมภาษีและกรมธรรม์ประกันภัยฉบับใหม่`;
        garageName = "สำนักงานขนส่ง และ บริษัทประกันภัย";
        garagePhone = "02-271-8888";
        garageLoc = "สำนักงานขนส่งทางบก / ตัวแทนประกัน";
        costEst = 16500;
      }

      const typeSelect = document.getElementById("mnt-order-type");
      if (typeSelect) {
        let exists = Array.from(typeSelect.options).some(o => o.value === orderType);
        if (!exists) {
          const opt = document.createElement("option");
          opt.value = orderType;
          opt.textContent = `🔄 ${orderType}`;
          typeSelect.appendChild(opt);
        }
        typeSelect.value = orderType;
      }

      const formIdEl = document.getElementById("mnt-form-id");
      if (formIdEl) formIdEl.value = "";
      const itemsEl = document.getElementById("mnt-service-items");
      if (itemsEl) itemsEl.value = serviceDesc;
      const costEl = document.getElementById("mnt-cost");
      if (costEl) costEl.value = costEst;
      const centerEl = document.getElementById("mnt-service-center");
      if (centerEl) centerEl.value = garageName;
      const phoneEl = document.getElementById("mnt-service-phone");
      if (phoneEl) phoneEl.value = garagePhone;
      const locEl = document.getElementById("mnt-service-loc");
      if (locEl) locEl.value = garageLoc;

      const todayStr = new Date().toISOString().split("T")[0];
      const tmrw = new Date();
      tmrw.setDate(tmrw.getDate() + 1);
      const tmrwStr = tmrw.toISOString().split("T")[0];

      const schedDate = document.getElementById("mnt-sched-date");
      if (schedDate) schedDate.value = todayStr;
      const schedTime = document.getElementById("mnt-sched-time");
      if (schedTime) schedTime.value = "09:00";
      const expDate = document.getElementById("mnt-exp-date");
      if (expDate) expDate.value = tmrwStr;
      const expTime = document.getElementById("mnt-exp-time");
      if (expTime) expTime.value = "17:00";

      const notesEl = document.getElementById("mnt-notes");
      if (notesEl) notesEl.value = `มอบหมายพนักงานไปดำเนินการต่อทะเบียน/ประกันภัย ทะเบียน ${car.plate} (เลขตัวถัง: ${car.chassis_no || '-'})`;
      const updateCarCheck = document.getElementById("mnt-update-car-status");
      if (updateCarCheck) updateCarCheck.checked = true;

      // Open Modal
      this.openModal("modal-new-maintenance");
    } catch (err) {
      console.error("Error opening renewal modal:", err);
      alert("เกิดข้อผิดพลาดในการเปิดหน้าต่างใบงาน: " + err.message);
    }
  },

  async quickRenewCarExpiry(plate, field) {
    this.openRenewalOrderModal(plate, field === "act_expiry" ? "act" : "ins");
  },

  async quickRenewBothExpiry(plate) {
    this.openRenewalOrderModal(plate, "both");
  },

  openExpiryModal(plate, field) {
    const car = (this.cars || []).find(c => c.plate === plate);
    if (!car) return;

    const labelType = field === "tax_expiry" ? "ภาษีรถยนต์" : (field === "act_expiry" ? "พ.ร.บ." : "ประกันภัย");
    const currVal = car[field] || "-";
    const info = this.parseExpiryDateInfo(currVal);

    document.getElementById("expiry-modal-plate").value = plate;
    document.getElementById("expiry-modal-field").value = field;
    document.getElementById("modal-expiry-title").textContent = `🔄 อัปเดตวันหมดอายุ ${labelType} (${plate})`;
    document.getElementById("expiry-modal-car-info").textContent = `🚘 ${plate} — ${car.brand || ''} ${car.model || ''} (${car.company || ''})`;
    document.getElementById("expiry-modal-current-info").textContent = `วันหมดอายุ ${labelType} ปัจจุบัน: ${info.formatted}`;

    // Pre-fill with +1 year from old expiry date by default
    this.applyExpiryPreset("old_1y");
    this.openModal("modal-update-expiry");
  },

  applyExpiryPreset(mode) {
    const plate = document.getElementById("expiry-modal-plate")?.value;
    const field = document.getElementById("expiry-modal-field")?.value;
    const car = (this.cars || []).find(c => c.plate === plate) || {};

    let newDateStr = "";
    if (mode === "old_1y") {
      newDateStr = this.computeRenewedDateStr(car[field]);
    } else {
      const now = new Date();
      const target = new Date(now.getFullYear() + 1, now.getMonth(), now.getDate());
      const dd = String(target.getDate()).padStart(2, "0");
      const mm = String(target.getMonth() + 1).padStart(2, "0");
      const yyyy = target.getFullYear();
      newDateStr = `${dd}/${mm}/${yyyy}`;
    }

    const parts = newDateStr.split("/");
    const textInput = document.getElementById("expiry-modal-text-input");
    const datePicker = document.getElementById("expiry-modal-date-picker");
    if (textInput) textInput.value = newDateStr;
    if (datePicker && parts.length === 3) {
      datePicker.value = `${parts[2]}-${parts[1]}-${parts[0]}`;
    }
  },

  onExpiryPickerChange(isoVal) {
    if (!isoVal) return;
    const parts = isoVal.split("-");
    if (parts.length === 3) {
      const textInput = document.getElementById("expiry-modal-text-input");
      if (textInput) textInput.value = `${parts[2]}/${parts[1]}/${parts[0]}`;
    }
  },

  async submitExpiryModal() {
    const plate = document.getElementById("expiry-modal-plate")?.value;
    const field = document.getElementById("expiry-modal-field")?.value;
    const rawNew = (document.getElementById("expiry-modal-text-input")?.value || "").trim();
    if (!plate || !field || !rawNew) {
      this.showToast("⚠️ กรุณาระบุวันหมดอายุใหม่", "warning");
      return;
    }

    const parsed = this.parseExpiryDateInfo(rawNew);
    const finalDateStr = parsed.valid ? parsed.formatted : rawNew;
    const labelType = field === "tax_expiry" ? "ภาษีรถยนต์" : (field === "act_expiry" ? "พ.ร.บ." : "ประกันภัย");

    this.closeModal("modal-update-expiry");
    await this.saveCarExpiryUpdate(plate, field, finalDateStr, labelType);
  },

  async saveCarExpiryUpdate(plate, field, newDateStr, labelType) {
    const car = (this.cars || []).find(c => c.plate === plate);
    if (!car) return;

    // Optimistically update in-memory car object and re-sort table immediately
    car[field] = newDateStr;
    this.renderFleetOverviewTable();

    const otherField = field === "act_expiry" ? "ins_expiry" : "act_expiry";
    const otherLabel = field === "act_expiry" ? "ประกันภัย" : "พ.ร.บ.";
    const otherInfo = this.parseExpiryDateInfo(car[otherField]);
    const sortMode = document.getElementById("dash-fleet-sort-select")?.value || "expiry_asc";

    const payload = Object.assign({}, car, {
      plate: plate,
      [field]: newDateStr
    });

    try {
      const res = await fetch("/api/cars", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (data.success) {
        if (sortMode === "expiry_asc" && otherInfo.valid && otherInfo.daysLeft <= 30) {
          this.showToast(`✅ อัปเดต ${labelType} ทะเบียน ${plate} เป็น ${newDateStr} แล้ว (หมายเหตุ: ${otherLabel} ยังหมดอายุ ${otherInfo.formatted} กด 🔄 ที่ ${otherLabel} หรือปุ่ม '🔄 ต่อคู่' เพื่อให้แถวเลื่อนลงไปท้ายตาราง)`, "success");
        } else {
          this.showToast(`✅ อัปเดตวันหมดอายุ ${labelType} ทะเบียน ${plate} เป็น ${newDateStr} เรียบร้อย! (เรียงลำดับตารางใหม่แล้ว)`, "success");
        }
        await this.loadCars();
      } else {
        this.showToast("❌ อัปเดตไม่สำเร็จ: " + (data.detail || "เกิดข้อผิดพลาด"), "danger");
      }
    } catch (e) {
      this.showToast("❌ เกิดข้อผิดพลาด: " + e.message, "danger");
    }
  },

  jumpToCarInFrontOffice(plate) {
    const sbSearch = document.getElementById("sb-search-input");
    if (sbSearch) sbSearch.value = plate;
    this.sidebarSearchKw = String(plate || "").toLowerCase().trim();
    this.switchModule("frontoffice");
    this.switchTab("fleet");
    this.renderFleetCards();
    this.showToast(`🚘 ข้ามไปยังข้อมูลรถยนต์ทะเบียน ${plate}`, "info");
  },

  setShiftClosingMode(mode) {
    this.shiftClosingMode = mode;
    const btnD = document.getElementById("btn-shift-mode-daily");
    const btnM = document.getElementById("btn-shift-mode-monthly");
    const thDate = document.getElementById("th-shift-date");

    if (btnD && btnM) {
      if (mode === "daily") {
        btnD.style.background = "#E85826";
        btnD.style.color = "#FFF";
        btnM.style.background = "transparent";
        btnM.style.color = "#475569";
        if (thDate) thDate.textContent = (this.currentLang === "EN") ? "Date (Daily)" : "วันที่ (รายวัน)";
      } else {
        btnM.style.background = "#E85826";
        btnM.style.color = "#FFF";
        btnD.style.background = "transparent";
        btnD.style.color = "#475569";
        if (thDate) thDate.textContent = (this.currentLang === "EN") ? "Period (Monthly)" : "งวดเดือน (รายเดือน)";
      }
    }
    this.renderShiftClosingTable();
  },

  filterShiftClosing() {
    this.renderShiftClosingTable();
  },

  resetShiftClosingFilter() {
    const f = document.getElementById("shift-month-filter");
    if (f) f.value = "";
    this.renderShiftClosingTable();
  },

  async loadFinanceSummary() {
    try {
      const res = await fetch("/api/finance/summary");
      if (res.ok) {
        this.financeSummaryData = await res.json();
        this.renderShiftClosingTable();
      }
    } catch (err) {
      console.error("loadFinanceSummary error:", err);
    }
  },

  renderShiftClosingTable() {
    if (!this.financeSummaryData) return;
    const isEn = (this.currentLang === "EN");
    const data = this.financeSummaryData;

    const sumTotalEl = document.getElementById("shift-sum-total");
    const sumQrEl = document.getElementById("shift-sum-qr");
    const sumCashEl = document.getElementById("shift-sum-cash");
    const sumCardEl = document.getElementById("shift-sum-card");
    const sumPaypalEl = document.getElementById("shift-sum-paypal");

    const byMethod = data.by_method || {};
    if (sumTotalEl) sumTotalEl.textContent = "฿" + Number(data.total_revenue || 0).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2});
    if (sumQrEl) sumQrEl.textContent = "฿" + Number(byMethod["โอนเงิน / สแกน QR"] || 0).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2});
    if (sumCashEl) sumCashEl.textContent = "฿" + Number(byMethod["เงินสด"] || 0).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2});
    if (sumCardEl) sumCardEl.textContent = "฿" + Number(byMethod["บัตรเครดิต"] || 0).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2});
    if (sumPaypalEl) sumPaypalEl.textContent = "฿" + Number(byMethod["PayPal"] || 0).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2});

    const tbody = document.getElementById("shift-closing-tbody");
    if (!tbody) return;

    const filterInput = document.getElementById("shift-month-filter");
    const filterVal = filterInput ? filterInput.value.trim() : "";

    const currentMode = this.shiftClosingMode || "daily";
    let rows = (currentMode === "monthly") ? (data.monthly || []) : (data.daily || []);
    if (filterVal) {
      rows = rows.filter(r => (r.month && r.month === filterVal) || (r.date && r.date.startsWith(filterVal)));
    }

    if (rows.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; color:#94A3B8; padding:20px;">${isEn ? 'No financial transactions recorded for this period' : 'ไม่มีรายการรายรับในงวดที่เลือก'}</td></tr>`;
      return;
    }

    tbody.innerHTML = rows.map((r, idx) => {
      const periodLabel = r.date || r.month || "-";
      const totalNum = Number(r.total || 0);
      const methods = r.by_method || {};
      const qrNum = Number(methods["โอนเงิน / สแกน QR"] || 0);
      const cashNum = Number(methods["เงินสด"] || 0);
      const cardNum = Number(methods["บัตรเครดิต"] || 0);
      const paypalNum = Number(methods["PayPal"] || 0);
      const countNum = Number(r.count || 0);
      const hasRecords = Array.isArray(r.records) && r.records.length > 0;

      return `
        <tr style="border-bottom:1px solid #F1F5F9;">
          <td style="padding:10px 12px; font-weight:700; color:#1E293B;">
            📅 ${periodLabel}
          </td>
          <td style="padding:10px 12px; text-align:right; font-weight:800; color:#EA580C; font-size:13px;">
            ฿${totalNum.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}
          </td>
          <td style="padding:10px 12px; text-align:right; font-weight:600; color:${qrNum > 0 ? '#2563EB' : '#94A3B8'};">
            ${qrNum > 0 ? '฿' + qrNum.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2}) : '-'}
          </td>
          <td style="padding:10px 12px; text-align:right; font-weight:600; color:${cashNum > 0 ? '#059669' : '#94A3B8'};">
            ${cashNum > 0 ? '฿' + cashNum.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2}) : '-'}
          </td>
          <td style="padding:10px 12px; text-align:right; font-weight:600; color:${cardNum > 0 ? '#DB2777' : '#94A3B8'};">
            ${cardNum > 0 ? '฿' + cardNum.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2}) : '-'}
          </td>
          <td style="padding:10px 12px; text-align:right; font-weight:600; color:${paypalNum > 0 ? '#7C3AED' : '#94A3B8'};">
            ${paypalNum > 0 ? '฿' + paypalNum.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2}) : '-'}
          </td>
          <td style="padding:10px 12px; text-align:center;">
            <span style="background:#F1F5F9; color:#475569; font-size:11.5px; font-weight:700; padding:2px 8px; border-radius:10px;">
              ${countNum} ${isEn ? 'tx' : 'รายการ'}
            </span>
          </td>
          <td style="padding:10px 12px; text-align:center;">
            ${hasRecords ? `
              <button type="button" onclick="app.toggleShiftRowDetails(${idx})" class="btn btn-sm btn-secondary" style="font-size:11px; padding:3px 8px;">
                🔍 ${isEn ? 'View' : 'ดูย่อย'}
              </button>
            ` : '-'}
          </td>
        </tr>
      `;
    }).join("");
  },

  toggleShiftRowDetails(idx) {
    const isEn = (this.currentLang === "EN");
    const box = document.getElementById("shift-closing-details-box");
    if (!box || !this.financeSummaryData) return;

    const currentMode = this.shiftClosingMode || "daily";
    const rows = (currentMode === "monthly") ? (this.financeSummaryData.monthly || []) : (this.financeSummaryData.daily || []);
    const row = rows[idx];
    if (!row || !Array.isArray(row.records)) {
      box.style.display = "none";
      return;
    }

    if (box.dataset.activeIdx === String(idx) && box.style.display === "block") {
      box.style.display = "none";
      box.dataset.activeIdx = "";
      return;
    }

    box.dataset.activeIdx = String(idx);
    box.style.display = "block";
    box.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; border-bottom:1px solid #CBD5E1; padding-bottom:6px;">
        <b style="font-size:13px; color:#1E293B;">🔍 ${isEn ? 'Transaction Details for' : 'รายละเอียดรายการประจำงวด'} ${row.date || row.month} (${row.records.length} ${isEn ? 'items' : 'รายการ'})</b>
        <button type="button" onclick="document.getElementById('shift-closing-details-box').style.display='none'" class="btn btn-sm btn-secondary" style="padding:1px 6px; font-size:11px;">✕ ${isEn ? 'Close' : 'ปิด'}</button>
      </div>
      <div class="table-responsive" style="max-height:180px; overflow-y:auto;">
        <table class="custom-table" style="margin:0; font-size:11.5px;">
          <thead>
            <tr style="background:#E2E8F0;">
              <th>${isEn ? 'Booking / Ref' : 'รหัสจอง / อ้างอิง'}</th>
              <th>${isEn ? 'Vehicle' : 'ทะเบียนรถ'}</th>
              <th>${isEn ? 'Customer' : 'ลูกค้า'}</th>
              <th>${isEn ? 'Category' : 'หมวดหมู่'}</th>
              <th>${isEn ? 'Method' : 'ช่องทางชำระ'}</th>
              <th style="text-align:right;">${isEn ? 'Amount (฿)' : 'ยอดเงิน (฿)'}</th>
            </tr>
          </thead>
          <tbody>
            ${row.records.map(rec => `
              <tr>
                <td style="font-weight:700;">${rec.ref || '-'}</td>
                <td>${rec.car_id || '-'}</td>
                <td>${rec.customer || '-'}</td>
                <td><span style="background:#EFF6FF; color:#1D4ED8; padding:1px 6px; border-radius:4px; font-size:10.5px; font-weight:600;">${rec.category || '-'}</span></td>
                <td><span style="font-weight:600;">${rec.payment_method || '-'}</span></td>
                <td style="text-align:right; font-weight:700; color:#EA580C;">฿${Number(rec.amount || 0).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    `;
  },

  exportShiftClosingCSV() {
    const filterInput = document.getElementById("shift-month-filter");
    const monthVal = filterInput ? filterInput.value.trim() : "";
    const mode = this.shiftClosingMode || "daily";
    const params = new URLSearchParams();
    if (monthVal) params.set("month", monthVal);
    params.set("mode", mode);
    const url = `/api/finance/export-csv?${params.toString()}`;
    window.open(url, "_blank");
  },

  printShiftClosingSlip() {
    const filterInput = document.getElementById("shift-month-filter");
    const monthVal = filterInput ? filterInput.value.trim() : "";
    const params = new URLSearchParams();
    if (monthVal) params.set("month", monthVal);
    const url = `/api/finance/print-slip?${params.toString()}`;
    window.open(url, "_blank");
  }
});
