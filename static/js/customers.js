/**
 * Sawasdee Rental - Customers Directory, Searchable Dropdown & Validation
 * Prototype Mixin for App
 */
Object.assign(App.prototype, {
  _getCustomerTierBadge(tier) {
    const t = String(tier || "ทั่วไป").trim();
    if (t === "VIP") {
      return `<span style="display:inline-block; background:#FEF3C7; color:#B45309; border:1px solid #F59E0B; border-radius:999px; font-size:10.5px; font-weight:800; padding:1px 7px; margin-left:4px;">👑 VIP</span>`;
    }
    if (t === "Blacklist") {
      return `<span style="display:inline-block; background:#FEE2E2; color:#B91C1C; border:1px solid #EF4444; border-radius:999px; font-size:10.5px; font-weight:800; padding:1px 7px; margin-left:4px;">⛔ Blacklist</span>`;
    }
    return `<span style="display:inline-block; background:#F1F5F9; color:#475569; border:1px solid #CBD5E1; border-radius:999px; font-size:10px; font-weight:600; padding:1px 6px; margin-left:4px;">ทั่วไป</span>`;
  },

  renderCustomersTable() {
    const tbody = document.getElementById("customers-table-tbody");
    if (!tbody) return;

    const kw = (document.getElementById("cust-search-input")?.value || "").toLowerCase().trim();
    const filtered = this.customers.filter(c => {
      if (kw) {
        const s = `${c.full_name} ${c.contact_no} ${c.passport_id} ${c.licence_no} ${c.crm_tier || ''} ${c.watchlist_note || ''}`.toLowerCase();
        if (!s.includes(kw)) return false;
      }
      return true;
    });

    tbody.innerHTML = filtered.map(c => {
      const safeName = String(c.full_name || '').replace(/'/g, "\\'");
      const isDefault = c.full_name === "ลูกค้าทั่วไป (Walk-in)";
      const tier = c.crm_tier || c.customer_tier || "ทั่วไป";
      const tierBadge = this._getCustomerTierBadge(tier);
      const note = c.watchlist_note || c.blacklist_reason || "";
      const rentals = Number(c.total_rentals || 0);
      const spent = Number(c.total_spent || 0);
      const dmg = Number(c.damage_count || 0);
      const historyLine = `<div style="font-size:10.5px; color:#475569; margin-top:3px;">📊 เช่า <b>${rentals}</b> ครั้ง | ฿${spent.toLocaleString()}${dmg > 0 ? ` <span style="color:#DC2626; font-weight:700;">• เสียหาย/ล่าช้า ${dmg}</span>` : ''}</div>`;
      const noteLine = note ? `<div style="font-size:10.5px; color:${tier === 'Blacklist' ? '#B91C1C' : '#92400E'}; margin-top:2px;">📝 ${note}</div>` : '';
      return `
        <tr style="${tier === 'Blacklist' ? 'background:#FEF2F2;' : ''}">
          <td>
            <b>${c.full_name}</b> ${tierBadge}
            ${historyLine}
            ${noteLine}
          </td>
          <td>
            📞 ${c.contact_no || '-'}<br/>
            ${c.whatsapp && c.whatsapp !== '-' ? `<span style="font-size:11px; color:#10B981;">WA: ${c.whatsapp}</span>` : ''}
          </td>
          <td>${c.passport_id || '-'}</td>
          <td>${c.licence_no || '-'}</td>
          <td>${c.nationality || 'THAI'}</td>
          <td style="max-width:180px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${c.thai_address}">${c.thai_address || '-'}</td>
          <td style="text-align:center; white-space:nowrap;">
            <button type="button" onclick="app.openEditCustomerModal('${safeName}')" class="btn btn-sm btn-secondary" title="ดู/แก้ไขข้อมูลลูกค้า" style="padding:3px 8px; font-size:12px; margin-right:4px;">
              ✏️
            </button>
            ${!isDefault ? `
              <button type="button" onclick="app.deleteCustomer('${safeName}')" class="btn btn-sm btn-danger" title="ลบข้อมูลลูกค้านี้" style="padding:3px 8px; font-size:12px;">
                🗑️
              </button>
            ` : ''}
          </td>
        </tr>
      `;
    }).join("");
  },

  populateCustomerDropdowns(preferredName = null) {
    if (preferredName) {
      this.lastAddedCustomerName = preferredName;
    }
    const hiddenEl = document.getElementById("book-cust-select");
    const searchInput = document.getElementById("book-cust-search-input");
    if (hiddenEl) {
      let curVal = preferredName || this.lastAddedCustomerName || hiddenEl.value || "";
      let matchedCust = (this.customers || []).find(c => c.full_name === curVal);
      if (!matchedCust) {
        matchedCust = (this.customers || []).find(c => c.full_name === "ลูกค้าทั่วไป (Walk-in)") || (this.customers || [])[0];
      }
      if (matchedCust) {
        hiddenEl.value = matchedCust.full_name;
        if (searchInput) {
          searchInput.value = `${matchedCust.full_name} (📞 ${matchedCust.contact_no || '-'})`;
        }
      }
      this.onSelectBookingCustomer();
    }
    const walkinSel = document.getElementById("walkin-cust-select");
    if (walkinSel) {
      const curVal = preferredName || this.lastAddedCustomerName || walkinSel.value || "";
      walkinSel.innerHTML = '<option value="">-- เลือกลูกค้าผู้เช่า --</option>' +
        this.customers.map(c => `<option value="${c.full_name}">${c.full_name} (📞 ${c.contact_no || '-'})</option>`).join("");
      if (curVal && Array.from(walkinSel.options).some(o => o.value === curVal)) {
        walkinSel.value = curVal;
      }
      this.onSelectWalkinCustomer();
    }
  },

  openBookingCustDropdown() {
    const menu = document.getElementById("book-cust-dropdown-menu");
    const input = document.getElementById("book-cust-search-input");
    if (!menu) return;
    menu.style.display = "block";
    if (input) {
      input.select();
    }
    this.filterBookingCustDropdown("");
  },

  toggleBookingCustDropdown() {
    const menu = document.getElementById("book-cust-dropdown-menu");
    if (!menu) return;
    if (menu.style.display === "block") {
      this.closeBookingCustDropdown();
    } else {
      this.openBookingCustDropdown();
    }
  },

  closeBookingCustDropdown() {
    const menu = document.getElementById("book-cust-dropdown-menu");
    if (menu) menu.style.display = "none";
    const hiddenEl = document.getElementById("book-cust-select");
    const input = document.getElementById("book-cust-search-input");
    if (hiddenEl && input) {
      const cust = (this.customers || []).find(c => c.full_name === hiddenEl.value);
      if (cust) {
        input.value = `${cust.full_name} (📞 ${cust.contact_no || '-'})`;
      }
    }
  },

  filterBookingCustDropdown(rawKw) {
    const menu = document.getElementById("book-cust-dropdown-menu");
    if (!menu) return;
    menu.style.display = "block";
    const kw = String(rawKw || "").trim().toLowerCase();
    const hiddenEl = document.getElementById("book-cust-select");
    const selectedName = hiddenEl ? hiddenEl.value : "";

    const filtered = (this.customers || []).filter(c => {
      if (!kw) return true;
      const fn = String(c.full_name || "").toLowerCase();
      const ph = String(c.contact_no || c.phone_number || "").toLowerCase();
      const pass = String(c.passport_id || c.id_card_no || "").toLowerCase();
      const lic = String(c.licence_no || c.driver_license_no || "").toLowerCase();
      return fn.includes(kw) || ph.includes(kw) || pass.includes(kw) || lic.includes(kw);
    });

    if (filtered.length === 0) {
      menu.innerHTML = `
        <div style="padding:14px; text-align:center; color:#94A3B8; font-size:12px;">
          ไม่พบข้อมูลลูกค้าสำหรับ "<b>${rawKw}</b>"<br/>
          <button type="button" onclick="app.closeBookingCustDropdown(); app.openAddCustomerModal();" class="btn btn-sm btn-primary" style="margin-top:8px; font-size:11px; padding:3px 10px;">
            ➕ กดเพิ่มลูกค้าใหม่
          </button>
        </div>
      `;
      return;
    }

    menu.innerHTML = filtered.map(c => {
      const isSelected = c.full_name === selectedName;
      const safeName = String(c.full_name || "").replace(/'/g, "\\'");
      const tier = c.crm_tier || c.customer_tier || "ทั่วไป";
      const tierBadge = tier !== "ทั่วไป" ? this._getCustomerTierBadge(tier) : "";
      const rowBg = tier === "Blacklist" ? "#FEF2F2" : (isSelected ? "#EFF6FF" : "#FFF");
      return `
        <div class="cust-drop-item" 
          onclick="app.selectBookingCustomer('${safeName}')"
          style="padding:9px 12px; cursor:pointer; border-bottom:1px solid #F1F5F9; display:flex; justify-content:space-between; align-items:center; background:${rowBg}; transition:background 0.15s;"
          onmouseover="this.style.background='${tier === 'Blacklist' ? '#FEE2E2' : (isSelected ? '#DBEAFE' : '#FFF7ED')}'"
          onmouseout="this.style.background='${rowBg}'">
          <div>
            <div style="font-weight:700; font-size:12.5px; color:${tier === 'Blacklist' ? '#B91C1C' : (isSelected ? '#1D4ED8' : '#1E293B')};">
              👤 ${c.full_name} ${tierBadge} ${isSelected ? '<span style="font-size:10.5px; color:#2563EB; font-weight:700;">(เลือกอยู่)</span>' : ''}
            </div>
            <div style="font-size:11px; color:#64748B; margin-top:2px;">
              📞 ${c.contact_no || c.phone_number || '-'} ${c.passport_id && c.passport_id !== '-' ? `| บัตร/ID: ${c.passport_id}` : ''} | เช่า ${Number(c.total_rentals || 0)} ครั้ง
            </div>
          </div>
          ${isSelected ? '<span style="color:#2563EB; font-weight:800; font-size:14px;">✓</span>' : ''}
        </div>
      `;
    }).join("");
  },

  selectBookingCustomer(name) {
    const hiddenEl = document.getElementById("book-cust-select");
    const input = document.getElementById("book-cust-search-input");
    const cust = (this.customers || []).find(c => c.full_name === name);
    if (!cust) return;

    if (hiddenEl) hiddenEl.value = cust.full_name;
    if (input) input.value = `${cust.full_name} (📞 ${cust.contact_no || '-'})`;
    this.closeBookingCustDropdown();
    this.onSelectBookingCustomer();
  },

  handleBookingCustKeydown(e) {
    if (e.key === "Escape") {
      this.closeBookingCustDropdown();
    } else if (e.key === "Enter") {
      e.preventDefault();
      const menu = document.getElementById("book-cust-dropdown-menu");
      const firstItem = menu?.querySelector(".cust-drop-item");
      if (firstItem) {
        firstItem.click();
      }
    }
  },

  onSelectBookingCustomer() {
    const sel = document.getElementById("book-cust-select");
    const badge = document.getElementById("book-cust-info-badge");
    const blAlert = document.getElementById("book-cust-blacklist-alert");
    if (!sel || !badge) return;
    const name = sel.value;
    const cust = this.customers.find(c => c.full_name === name);
    if (!cust) {
      badge.style.display = "none";
      if (blAlert) {
        blAlert.style.display = "none";
        blAlert.innerHTML = "";
      }
      return;
    }
    const tier = cust.crm_tier || cust.customer_tier || "ทั่วไป";
    const tierBadge = this._getCustomerTierBadge(tier);
    const rentals = Number(cust.total_rentals || 0);
    const spent = Number(cust.total_spent || 0);
    const dmg = Number(cust.damage_count || 0);
    const note = cust.watchlist_note || cust.blacklist_reason || "";

    badge.style.display = "block";
    badge.innerHTML = `
      <div style="line-height:1.5;">
        <b>${cust.full_name}</b> ${tierBadge} | เบอร์โทร: <b>${cust.contact_no || '-'}</b> | เลขบัตร/Passport: <b style="color:#2563EB;">${cust.passport_id || '-'}</b> | ใบขับขี่: <b>${cust.licence_no || '-'}</b><br/>
        ที่อยู่: <span style="color:#64748B;">${cust.thai_address || cust.home_address || '-'}</span> • <span style="color:#334155;">ประวัติเช่า ${rentals} ครั้ง (฿${spent.toLocaleString()})</span>
      </div>
    `;

    if (blAlert) {
      if (tier === "Blacklist") {
        blAlert.style.display = "block";
        blAlert.innerHTML = `
          ⛔ <b>แจ้งเตือนลูกค้า Blacklist (บัญชีดำ / เฝ้าระวังพิเศษ)!</b><br/>
          สาเหตุ / หมายเหตุ: <b>${note || 'มีความเสี่ยง / ประวัติค้างชำระหรือทำความเสียหาย'}</b><br/>
          <span style="font-size:11.5px;">📊 ประวัติเช่าสะสม ${rentals} ครั้ง • ประวัติเสียหาย/คืนล่าช้า ${dmg} ครั้ง — กรุณาตรวจสอบเอกสารและพิจารณาเงินมัดจำอย่างละเอียดก่อนปล่อยรถ</span>
        `;
      } else {
        blAlert.style.display = "none";
        blAlert.innerHTML = "";
      }
    }
  },

  onSelectWalkinCustomer() {
    const sel = document.getElementById("walkin-cust-select");
    const badge = document.getElementById("walkin-cust-info-badge");
    if (!sel || !badge) return;
    const name = sel.value;
    const cust = this.customers.find(c => c.full_name === name);
    if (!cust) {
      badge.style.display = "none";
      return;
    }
    const tier = cust.crm_tier || cust.customer_tier || "ทั่วไป";
    const tierBadge = this._getCustomerTierBadge(tier);
    const note = cust.watchlist_note || cust.blacklist_reason || "";
    const blWarn = tier === "Blacklist"
      ? `<div style="margin-top:6px; padding:6px 8px; background:#FEF2F2; border:1px solid #DC2626; border-radius:6px; color:#991B1B; font-weight:700;">⛔ แจ้งเตือนลูกค้า Blacklist: ${note || 'เฝ้าระวังพิเศษ'}</div>`
      : "";
    badge.style.display = "block";
    badge.innerHTML = `
      <div style="line-height:1.5;">
        <b>${cust.full_name}</b> ${tierBadge} | เบอร์โทร: <b>${cust.contact_no || '-'}</b> | เลขบัตร/Passport: <b style="color:#2563EB;">${cust.passport_id || '-'}</b> | ใบขับขี่: <b>${cust.licence_no || '-'}</b>
        ${blWarn}
      </div>
    `;
  },

  openEditCustomerModal(customerName) {
    const cust = (this.customers || []).find(c => c.full_name === customerName)
      || (this.customers || []).find(c => String(c.id) === String(customerName) || String(c.customer_id) === String(customerName) || c.contact_no === customerName || c.phone_number === customerName || c.passport_id === customerName);
    if (!cust) {
      this.showToast("⚠️ ไม่พบข้อมูลลูกค้าที่ต้องการแก้ไข", "warning");
      return;
    }
    document.getElementById("cust-original-name").value = cust.full_name;
    document.getElementById("cust-name-in").value = cust.full_name || "";
    const pVal = cust.phone_number || cust.contact_no || cust.phone;
    document.getElementById("cust-phone-in").value = (pVal && pVal !== "-") ? pVal : "";
    const idVal = cust.id_card_no || cust.passport_id || cust.id_card;
    document.getElementById("cust-pass-in").value = (idVal && idVal !== "-") ? idVal : "";
    const licVal = cust.driver_license_no || cust.licence_no || cust.driver_license;
    document.getElementById("cust-lic-in").value = (licVal && licVal !== "-") ? licVal : "";
    document.getElementById("cust-nat-in").value = cust.nationality || "THAI";
    document.getElementById("cust-wa-in").value = (cust.whatsapp && cust.whatsapp !== "-") ? cust.whatsapp : "";
    document.getElementById("cust-dob-in").value = this.dmyToYmd(cust.dob) || "";
    document.getElementById("cust-licexp-in").value = this.dmyToYmd(cust.license_expire_date || cust.licence_expiry) || "";
    document.getElementById("cust-home-in").value = (cust.home_address && cust.home_address !== "-") ? cust.home_address : "";
    const currVal = cust.current_address || cust.thai_address || cust.address;
    document.getElementById("cust-thai-in").value = (currVal && currVal !== "-") ? currVal : "";
    const emailVal = cust.email;
    const emailEl = document.getElementById("cust-email-in");
    if (emailEl) emailEl.value = (emailVal && emailVal !== "-") ? emailVal : "";
    const lineVal = cust.line_user_id || cust.line_id;
    const lineEl = document.getElementById("cust-line-in");
    if (lineEl) lineEl.value = (lineVal && lineVal !== "-") ? lineVal : "";
    const tierEl = document.getElementById("cust-tier-in");
    if (tierEl) tierEl.value = cust.crm_tier || cust.customer_tier || "ทั่วไป";
    const noteEl = document.getElementById("cust-note-in");
    if (noteEl) noteEl.value = cust.watchlist_note || cust.blacklist_reason || cust.notes || "";

    document.getElementById("modal-cust-title").textContent = `✏️ ดูและแก้ไขข้อมูลลูกค้า (${cust.full_name})`;
    const btnSave = document.getElementById("btn-modal-cust-save");
    if (btnSave) btnSave.textContent = "💾 บันทึกการแก้ไข";

    const btnDel = document.getElementById("btn-modal-cust-delete");
    if (btnDel) {
      btnDel.style.display = cust.full_name === "ลูกค้าทั่วไป (Walk-in)" ? "none" : "inline-flex";
    }

    const warnPhone = document.getElementById("cust-phone-warn");
    if (warnPhone) { warnPhone.style.display = "none"; warnPhone.textContent = ""; }
    const warnPass = document.getElementById("cust-pass-warn");
    if (warnPass) { warnPass.style.display = "none"; warnPass.textContent = ""; }

    this.openModal("modal-add-customer");
    setTimeout(() => document.getElementById("cust-phone-in")?.focus(), 80);
  },

  openEditSelectedCustomerModal(context = 'book') {
    const selId = context === 'book' ? "book-cust-select" : "walkin-cust-select";
    const name = document.getElementById(selId)?.value;
    if (!name) {
      this.showToast("⚠️ กรุณาเลือกลูกค้าก่อนกดแก้ไข", "warning");
      return;
    }
    this.openEditCustomerModal(name);
  },

  async deleteSelectedCustomer(context = 'book') {
    const selId = context === 'book' ? "book-cust-select" : "walkin-cust-select";
    const name = document.getElementById(selId)?.value;
    if (!name) {
      this.showToast("⚠️ กรุณาเลือกลูกค้าก่อนกดลบ", "warning");
      return;
    }
    if (name === "ลูกค้าทั่วไป (Walk-in)") {
      this.showToast("⚠️ ไม่สามารถลบ 'ลูกค้าทั่วไป (Walk-in)' ได้", "warning");
      return;
    }
    await this.deleteCustomer(name);
  },

  async deleteCurrentEditingCustomer() {
    const origName = document.getElementById("cust-original-name")?.value || document.getElementById("cust-name-in")?.value;
    if (!origName) return;
    this.closeModal("modal-add-customer");
    await this.deleteCustomer(origName);
  },

  checkDuplicatePhone(val) {
    const warnEl = document.getElementById("cust-phone-warn");
    if (!warnEl) return;
    const cleanDigits = String(val || "").replace(/\D/g, "");
    if (!cleanDigits || cleanDigits.length < 9) {
      warnEl.style.display = "none";
      warnEl.textContent = "";
      return;
    }
    const normPhone = cleanDigits.startsWith("66") ? "0" + cleanDigits.slice(2) : cleanDigits;
    const origName = (document.getElementById("cust-original-name")?.value || "").trim();
    const currentName = (document.getElementById("cust-name-in")?.value || "").trim();

    const dup = (this.customers || []).find(c => {
      if (c.full_name === currentName || (origName && c.full_name === origName)) return false;
      const existPhone = String(c.contact_no || "").replace(/\D/g, "");
      if (!existPhone || existPhone.length < 9) return false;
      const existNorm = existPhone.startsWith("66") ? "0" + existPhone.slice(2) : existPhone;
      return existNorm === normPhone;
    });

    if (dup) {
      warnEl.style.display = "block";
      warnEl.innerHTML = `⚠️ เบอร์โทรศัพท์นี้ซ้ำกับลูกค้า: <b>${dup.full_name}</b> (เลขบัตร/Passport: ${dup.passport_id || '-'}) ในระบบแล้ว (ห้ามใช้ซ้ำ)`;
    } else {
      warnEl.style.display = "none";
      warnEl.textContent = "";
    }
  },

  checkDuplicatePassport(val) {
    const warnEl = document.getElementById("cust-pass-warn");
    if (!warnEl) return;
    const clean = String(val || "").replace(/[\s-]/g, "").toLowerCase();
    if (!clean || clean === "-" || clean === "none") {
      warnEl.style.display = "none";
      warnEl.textContent = "";
      return;
    }
    const origName = (document.getElementById("cust-original-name")?.value || "").trim();
    const currentName = (document.getElementById("cust-name-in")?.value || "").trim();

    const dup = (this.customers || []).find(c => {
      if (c.full_name === currentName || (origName && c.full_name === origName)) return false;
      const existPass = String(c.passport_id || "").replace(/[\s-]/g, "").toLowerCase();
      return existPass && existPass !== "-" && existPass !== "none" && existPass === clean;
    });

    if (dup) {
      warnEl.style.display = "block";
      warnEl.innerHTML = `⚠️ หมายเลขบัตร ปชช. / พาสปอร์ตนี้ซ้ำกับลูกค้า: <b>${dup.full_name}</b> (📞 ${dup.contact_no || '-'}) ในระบบแล้ว (ห้ามใช้ซ้ำ)`;
    } else {
      warnEl.style.display = "none";
      warnEl.textContent = "";
    }
  },

  openAddCustomerModal() {
    const origEl = document.getElementById("cust-original-name");
    if (origEl) origEl.value = "";
    ["cust-name-in", "cust-phone-in", "cust-pass-in", "cust-lic-in", "cust-wa-in", "cust-home-in", "cust-thai-in", "cust-email-in", "cust-line-in"].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = "";
    });
    const titleEl = document.getElementById("modal-cust-title");
    if (titleEl) titleEl.textContent = "➕ เพิ่มข้อมูลลูกค้าใหม่ (Add New Customer)";
    const btnSave = document.getElementById("btn-modal-cust-save");
    if (btnSave) btnSave.textContent = "💾 บันทึกข้อมูลลูกค้า";
    const btnDel = document.getElementById("btn-modal-cust-delete");
    if (btnDel) btnDel.style.display = "none";

    const warnPhone = document.getElementById("cust-phone-warn");
    if (warnPhone) { warnPhone.style.display = "none"; warnPhone.textContent = ""; }
    const warnPass = document.getElementById("cust-pass-warn");
    if (warnPass) { warnPass.style.display = "none"; warnPass.textContent = ""; }

    const natEl = document.getElementById("cust-nat-in");
    if (natEl) natEl.value = "THAI";
    const dobEl = document.getElementById("cust-dob-in");
    if (dobEl) dobEl.value = "";
    const licExpEl = document.getElementById("cust-licexp-in");
    if (licExpEl) licExpEl.value = "";
    const tierEl = document.getElementById("cust-tier-in");
    if (tierEl) tierEl.value = "ทั่วไป";
    const noteEl = document.getElementById("cust-note-in");
    if (noteEl) noteEl.value = "";

    this.openModal("modal-add-customer");
    setTimeout(() => document.getElementById("cust-name-in")?.focus(), 80);
  },

  async submitNewCustomer() {
    const name = (document.getElementById("cust-name-in")?.value || "").trim();
    const origName = (document.getElementById("cust-original-name")?.value || "").trim();

    if (!name) {
      alert("กรุณาระบุชื่อ-นามสกุลลูกค้า");
      return;
    }

    // 1. Phone number duplicate check
    const phone = (document.getElementById("cust-phone-in")?.value || "").trim();
    if (phone && phone !== "-" && phone.toLowerCase() !== "none") {
      const cleanDigits = phone.replace(/\D/g, "");
      if (cleanDigits.length >= 9) {
        const normPhone = cleanDigits.startsWith("66") ? "0" + cleanDigits.slice(2) : cleanDigits;
        const dupPhone = (this.customers || []).find(c => {
          if (c.full_name === name || (origName && c.full_name === origName)) return false;
          const existPhone = String(c.contact_no || "").replace(/\D/g, "");
          if (!existPhone || existPhone.length < 9) return false;
          const existNorm = existPhone.startsWith("66") ? "0" + existPhone.slice(2) : existPhone;
          return existNorm === normPhone;
        });
        if (dupPhone) {
          this.showToast(`❌ ไม่อนุญาตให้ใช้เบอร์โทรศัพท์ซ้ำกับ '${dupPhone.full_name}'`, "danger");
          alert(`❌ ระบบไม่อนุญาตให้ใช้เบอร์โทรศัพท์ซ้ำ!\n\nเบอร์ '${phone}' ซ้ำกับข้อมูลของลูกค้า '${dupPhone.full_name}' ที่มีอยู่ในระบบแล้ว กรุณาตรวจสอบ`);
          const warnEl = document.getElementById("cust-phone-warn");
          if (warnEl) {
            warnEl.style.display = "block";
            warnEl.innerHTML = `⚠️ เบอร์โทรศัพท์นี้ซ้ำกับลูกค้า: <b>${dupPhone.full_name}</b> ในระบบแล้ว (ห้ามใช้ซ้ำ)`;
          }
          document.getElementById("cust-phone-in")?.focus();
          return;
        }
      }
    }

    // 2. Citizen ID / Passport duplicate check
    const passId = (document.getElementById("cust-pass-in")?.value || "").trim();
    if (passId && passId !== "-" && passId.toLowerCase() !== "none") {
      const cleanPass = passId.replace(/[\s-]/g, "").toLowerCase();
      const duplicate = (this.customers || []).find(c => {
        if (c.full_name === name || (origName && c.full_name === origName)) return false;
        const existPass = String(c.passport_id || "").trim();
        if (!existPass || existPass === "-" || existPass.toLowerCase() === "none") return false;
        return existPass.replace(/[\s-]/g, "").toLowerCase() === cleanPass;
      });
      if (duplicate) {
        this.showToast(`❌ ไม่อนุญาตให้ใช้เลขบัตร/พาสปอร์ตซ้ำกับ '${duplicate.full_name}'`, "danger");
        alert(`❌ ระบบไม่อนุญาตให้ใช้เลขบัตรประชาชนหรือพาสปอร์ตซ้ำ!\n\nหมายเลข '${passId}' ซ้ำกับข้อมูลของลูกค้า '${duplicate.full_name}' ที่มีอยู่ในระบบแล้ว กรุณาตรวจสอบ`);
        const warnEl = document.getElementById("cust-pass-warn");
        if (warnEl) {
          warnEl.style.display = "block";
          warnEl.innerHTML = `⚠️ หมายเลขบัตร ปชช. / พาสปอร์ตนี้ซ้ำกับลูกค้า: <b>${duplicate.full_name}</b> ในระบบแล้ว (ห้ามใช้ซ้ำ)`;
        }
        document.getElementById("cust-pass-in")?.focus();
        return;
      }
    }

    const licNo = document.getElementById("cust-lic-in")?.value.trim() || "-";
    const nat = document.getElementById("cust-nat-in")?.value.trim() || "THAI";
    const wa = document.getElementById("cust-wa-in")?.value.trim() || "-";
    const dobVal = (document.getElementById("cust-dob-in")?.value || "").trim();
    const dobFormatted = dobVal ? (this.ymdToDmy(dobVal) || dobVal) : "-";
    const licExpVal = (document.getElementById("cust-licexp-in")?.value || "").trim();
    const licExpFormatted = licExpVal ? (this.ymdToDmy(licExpVal) || licExpVal) : "-";
    const homeAddr = document.getElementById("cust-home-in")?.value.trim() || "-";
    const currAddr = document.getElementById("cust-thai-in")?.value.trim() || "-";
    const email = document.getElementById("cust-email-in")?.value.trim() || "-";
    const lineId = document.getElementById("cust-line-in")?.value.trim() || "-";
    const crmTier = document.getElementById("cust-tier-in")?.value || "ทั่วไป";
    const watchlistNote = document.getElementById("cust-note-in")?.value.trim() || "";

    const payload = {
      // 10 Standard Customer Fields
      full_name: name,
      phone_number: phone || "-",
      id_card_no: passId || "-",
      driver_license_no: licNo,
      nationality: nat,
      whatsapp: wa,
      dob: dobFormatted,
      license_expire_date: licExpFormatted,
      home_address: homeAddr,
      current_address: currAddr,
      email: email,
      line_user_id: lineId,
      line_id: lineId,
      crm_tier: crmTier,
      customer_tier: crmTier,
      watchlist_note: watchlistNote,
      blacklist_reason: watchlistNote,
      notes: watchlistNote,

      // Compatibility Aliases
      original_name: origName || name,
      contact_no: phone || "-",
      phone: phone || "-",
      passport_id: passId || "-",
      id_card: passId || "-",
      licence_no: licNo,
      driver_license: licNo,
      licence_expiry: licExpFormatted,
      home_address: homeAddr,
      thai_address: currAddr,
      address: homeAddr
    };

    try {
      const res = await fetch("/api/customers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        const errMsg = data.detail || data.error || "เกิดข้อผิดพลาดในการบันทึกข้อมูล";
        this.showToast("❌ บันทึกไม่สำเร็จ: " + errMsg, "danger");
        alert("❌ บันทึกไม่สำเร็จ: " + errMsg);
        return;
      }
      this.lastAddedCustomerName = name;
      if (origName && origName !== name) {
        this.customers = this.customers.filter(c => c.full_name !== origName);
      }
      const savedCust = data.customer || payload;
      const existIdx = this.customers.findIndex(c => c.full_name === name);
      if (existIdx >= 0) {
        this.customers[existIdx] = savedCust;
      } else {
        this.customers.unshift(savedCust);
      }
      this.populateCustomerDropdowns(name);
      this.closeModal("modal-add-customer");
      this.showToast(`🎉 บันทึกข้อมูลลูกค้า '${name}' เรียบร้อย!`, "success");
      await this.loadCustomers();
      this.populateCustomerDropdowns(name);
      this.renderCustomersTable();
    } catch (e) {
      this.showToast("บันทึกไม่สำเร็จ: " + e.message, "danger");
    }
  },

  async deleteCustomer(name) {
    if (name === "ลูกค้าทั่วไป (Walk-in)") {
      this.showToast("⚠️ ไม่สามารถลบ 'ลูกค้าทั่วไป (Walk-in)' ได้", "warning");
      return;
    }
    if (!confirm(`คุณแน่ใจหรือไม่ว่าต้องการลบข้อมูลลูกค้า '${name}' ออกจากระบบ? (กรณีบันทึกผิดหรือข้อมูลซ้ำ)`)) return;
    try {
      const res = await fetch(`/api/customers/${encodeURIComponent(name)}`, { method: "DELETE" });
      const data = await res.json();
      if (data.success) {
        this.showToast(`🗑️ ลบข้อมูลลูกค้า '${name}' เรียบร้อยแล้ว`, "success");
        this.customers = this.customers.filter(c => c.full_name !== name);
        if (this.lastAddedCustomerName === name) {
          this.lastAddedCustomerName = null;
        }
        await this.loadCustomers();
        this.populateCustomerDropdowns();
        this.renderCustomersTable();
      } else {
        this.showToast("ลบไม่สำเร็จ: " + (data.detail || "เกิดข้อผิดพลาด"), "danger");
      }
    } catch (e) {
      this.showToast("ลบไม่สำเร็จ: " + e.message, "danger");
    }
  }
});
