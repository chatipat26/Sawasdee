/**
 * Sawasdee Rental - Maintenance & Service Work Orders Management
 * Prototype Mixin for App
 */
Object.assign(App.prototype, {
  async loadMaintenanceRecords() {
    try {
      const res = await fetch("/api/maintenance");
      if (res.ok) {
        this.maintenanceRecords = await res.json();
        const badge = document.getElementById("badge-maintenance-jobs");
        const activeCount = this.maintenanceRecords.filter(m => m.status !== "เสร็จสิ้น" && m.status !== "ยกเลิก").length;
        if (badge) badge.textContent = activeCount;
        this.populateMaintenanceDropdowns();
        this.renderMaintenanceRecords();
      }
    } catch (e) {
      console.error("loadMaintenanceRecords error:", e);
    }
  },

  populateMaintenanceDropdowns() {
    const carSel = document.getElementById("mnt-filter-car");
    if (carSel) {
      const cur = carSel.value;
      const isEn = (this.currentLang === "EN");
      const opts = [`<option value="ทั้งหมด">${isEn ? 'All Vehicles' : 'ทุกคัน'}</option>`];
      (this.cars || []).forEach(c => {
        opts.push(`<option value="${c.plate}">${c.plate} - ${c.brand || ''} ${c.model || ''}</option>`);
      });
      carSel.innerHTML = opts.join("");
      if (cur) carSel.value = cur;
    }
  },

  renderMaintenanceRecords() {
    const tbody = document.getElementById("maintenance-records-tbody");
    if (!tbody) return;

    const kw = (document.getElementById("mnt-search-input")?.value || "").toLowerCase().trim();
    const typeFilter = document.getElementById("mnt-filter-type")?.value || "ทั้งหมด";
    const statusFilter = document.getElementById("mnt-filter-status")?.value || "ทั้งหมด";
    const carFilter = document.getElementById("mnt-filter-car")?.value || "ทั้งหมด";

    // KPIs calculation
    const allRecords = this.maintenanceRecords || [];
    const inProg = allRecords.filter(m => m.status === "กำลังซ่อมบำรุง").length;
    const pending = allRecords.filter(m => m.status === "รอดำเนินการ").length;
    const totalCost = allRecords.reduce((sum, m) => sum + Number(m.actual_cost || m.cost || 0), 0);
    const renewals = allRecords.filter(m => {
      const t = String(m.order_type || "");
      return t.includes("ต่อทะเบียน") || t.includes("พ.ร.บ.") || t.includes("พรบ") || t.includes("ประกัน");
    }).length;

    const isEn = (this.currentLang === "EN");
    const carUnit = isEn ? "cars" : "คัน";
    const jobUnit = isEn ? "jobs" : "รายการ";

    const elInProg = document.getElementById("mnt-kpi-in-progress");
    if (elInProg) elInProg.innerHTML = `${inProg} <span style="font-size:13px; font-weight:500; color:#64748B;">${carUnit}</span>`;
    const elPending = document.getElementById("mnt-kpi-pending");
    if (elPending) elPending.innerHTML = `${pending} <span style="font-size:13px; font-weight:500; color:#64748B;">${jobUnit}</span>`;
    const elCost = document.getElementById("mnt-kpi-total-cost");
    if (elCost) elCost.textContent = `฿${totalCost.toLocaleString()}`;
    const elRen = document.getElementById("mnt-kpi-renewals");
    if (elRen) elRen.innerHTML = `${renewals} <span style="font-size:13px; font-weight:500; color:#64748B;">${jobUnit}</span>`;

    // Filter records (Target Mission 3: Hide completed tasks from active view by default)
    const filtered = allRecords.filter(m => {
      if (carFilter !== "ทั้งหมด" && m.car_id !== carFilter) return false;
      if (statusFilter === "ทั้งหมด" || statusFilter === "All" || !statusFilter) {
        if (m.status === "เสร็จสิ้น" || m.status === "Completed") return false;
      } else if (statusFilter !== "all_with_completed") {
        if (m.status !== statusFilter) return false;
      }
      if (typeFilter !== "ทั้งหมด") {
        if (!String(m.order_type || "").includes(typeFilter)) return false;
      }
      if (kw) {
        const s = `${m.id || ''} ${m.car_id || ''} ${m.car_brand || ''} ${m.car_model || ''} ${m.service_center || ''} ${m.service_items || ''} ${m.assigned_worker || ''} ${m.notes || ''}`.toLowerCase();
        if (!s.includes(kw)) return false;
      }
      return true;
    });

    const countTxt = document.getElementById("mnt-table-count");
    if (countTxt) countTxt.textContent = filtered.length;

    if (filtered.length === 0) {
      tbody.innerHTML = `<tr><td colspan="10" style="text-align:center; padding:32px; color:#64748B;">${isEn ? 'No maintenance work orders match the selected filters' : 'ไม่พบรายการใบงานซ่อมบำรุงตามเงื่อนไขที่เลือก'}</td></tr>`;
      return;
    }

    tbody.innerHTML = filtered.map(m => {
      const isRenewal = String(m.order_type || "").includes("ต่อทะเบียน") || String(m.order_type || "").includes("พ.ร.บ.") || String(m.order_type || "").includes("ประกัน");
      let typeBadge = '';
      if (isRenewal) {
        typeBadge = '<span class="badge" style="background:#F0FDF4; color:#15803D; border:1px solid #BBF7D0; font-weight:700;">' + m.order_type + '</span>';
      } else {
        typeBadge = '<span class="badge" style="background:#FFF7ED; color:#C2410C; border:1px solid #FDBA74; font-weight:700;">' + m.order_type + '</span>';
      }

      let statusBadge = '';
      if (m.status === "เสร็จสิ้น") {
        statusBadge = `<span class="badge badge-success">${isEn ? '✅ Completed' : '✅ เสร็จสิ้น'}</span>`;
      } else if (m.status === "กำลังซ่อมบำรุง") {
        statusBadge = `<span class="badge" style="background:#FFF7ED; color:#C2410C; border:1px solid #FDBA74;">${isEn ? '🛠️ In Repair' : '🛠️ กำลังซ่อมบำรุง'}</span>`;
      } else if (m.status === "กำลังต่อภาษี/ประกัน") {
        statusBadge = `<span class="badge" style="background:#FEF3C7; color:#D97706; border:1px solid #FCD34D;">${isEn ? '⏳ Renewing Tax/Ins.' : '⏳ กำลังต่อภาษี/ประกัน'}</span>`;
      } else {
        statusBadge = `<span class="badge badge-warning">${isEn ? '⏳ Pending' : '⏳ ' + m.status}</span>`;
      }

      const costDisp = Number(m.actual_cost || m.cost || 0);
      const schedStr = `${this.formatDateDmy(m.schedule_date)} ➔ ${this.formatDateDmy(m.expected_finish_date)}`;

      const pdfBtnText = isEn ? "Work Order PDF" : "ใบงาน PDF";
      const finishBtnText = isRenewal ? (isEn ? 'Submit & Renew' : 'ส่งงาน/อัปเดตวัน') : (isEn ? 'Close Job' : 'ปิดงาน');
      const finishBtnTitle = isRenewal ? (isEn ? 'Submit job & specify new expiry date' : 'ส่งงาน & ระบุวันหมดอายุใหม่') : (isEn ? 'Inspect car & close work order' : 'ตรวจรับรถ & ปิดงาน');

      return `
        <tr>
          <td><b style="color:#C2410C;">${m.id}</b></td>
          <td>
            <b style="font-size:13px; color:#1F2937;">${m.car_id}</b><br/>
            <span style="font-size:11.5px; color:#64748B;">${m.car_brand || ''} ${m.car_model || ''} (${m.car_color || '-'})</span>
          </td>
          <td>${typeBadge}</td>
          <td style="max-width:200px; white-space:pre-wrap; font-size:12px; line-height:1.4;">${m.service_items || '-'}</td>
          <td><b style="color:#047857; font-size:13px;">฿${costDisp.toLocaleString()}</b></td>
          <td>
            <b style="color:#1F2937; font-size:12.5px;">${m.service_center || '-'}</b><br/>
            ${m.service_center_phone && m.service_center_phone !== '-' ? `<a href="tel:${m.service_center_phone}" style="color:#2563EB; font-size:11.5px; text-decoration:none;">${m.service_center_phone}</a>` : ''}
          </td>
          <td><span style="font-weight:600; color:#334155; font-size:12px;">${m.assigned_worker || '-'}</span></td>
          <td style="font-size:11.5px; color:#475569;">${schedStr}</td>
          <td>${statusBadge}</td>
          <td style="text-align:center; white-space:nowrap;">
            <a href="/api/pdf/maintenance/${m.id}" target="_blank" class="btn btn-sm btn-secondary" title="${pdfBtnText}">${pdfBtnText}</a>
            ${m.status !== "เสร็จสิ้น" ? `
              <button onclick="app.openCloseMaintenanceModal('${m.id}')" class="btn btn-sm btn-success" style="font-weight:700;" title="${finishBtnTitle}">
                ${finishBtnText}
              </button>
            ` : ''}
            <button onclick="app.openEditMaintenanceModal('${m.id}')" class="btn btn-sm btn-secondary" title="${isEn ? 'Edit Order' : 'แก้ไขใบงาน'}">✏️</button>
            <button onclick="app.deleteMaintenanceRecord('${m.id}')" class="btn btn-sm btn-danger" title="${isEn ? 'Delete Order' : 'ลบใบงาน'}">🗑️</button>
          </td>
        </tr>
      `;
    }).join("");
  },

  populateMaintenanceCars(searchKw = "") {
    const listEl = document.getElementById("mnt-car-dropdown-list");
    const carSel = document.getElementById("mnt-car-select");
    const currentCarId = carSel ? carSel.value : "";

    // Always keep hidden #mnt-car-select populated with options for 100% backward compatibility
    if (carSel) {
      const opts = (this.cars || []).map(c => `<option value="${c.plate}">${c.plate} - ${c.brand || ''} ${c.model || ''} (${c.color || ''}) [${c.status}]</option>`);
      carSel.innerHTML = opts.join("");
      if (currentCarId) carSel.value = currentCarId;
    }

    if (!listEl) return;
    const kw = (searchKw || "").toLowerCase().trim();
    const filtered = (this.cars || []).filter(c => {
      if (!kw) return true;
      const plateMatch = (c.plate || "").toLowerCase().includes(kw);
      const brandMatch = (c.brand || "").toLowerCase().includes(kw);
      const modelMatch = (c.model || "").toLowerCase().includes(kw);
      const colorMatch = (c.color || "").toLowerCase().includes(kw);
      const statusMatch = (c.status || "").toLowerCase().includes(kw);
      return plateMatch || brandMatch || modelMatch || colorMatch || statusMatch;
    });

    if (filtered.length === 0) {
      listEl.innerHTML = `<div style="padding:10px 14px; color:#94A3B8; font-size:12px; text-align:center;">ไม่พบข้อมูลรถยนต์ที่ตรงกับ "${kw}"</div>`;
      return;
    }

    listEl.innerHTML = filtered.map(c => {
      const isSelected = c.plate === currentCarId;
      const statusBg = c.status === "ว่างพร้อมใช้งาน" ? "#ECFDF5" : (c.status === "สถานะซ่อมบำรุง" ? "#FEF2F2" : "#FFFBEB");
      const statusColor = c.status === "ว่างพร้อมใช้งาน" ? "#065F46" : (c.status === "สถานะซ่อมบำรุง" ? "#991B1B" : "#92400E");
      return `
        <div class="mnt-car-option-item ${isSelected ? 'selected' : ''}" 
             onclick="app.selectMaintenanceCar('${c.plate}')"
             title="${c.plate} - ${c.brand || ''} ${c.model || ''}">
          <div style="flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; padding-right:8px;">
            <span style="font-weight:800; color:#0F172A; margin-right:6px;">${c.plate}</span>
            <span style="color:#334155; font-weight:600;">${c.brand || ''} ${c.model || ''}</span>
            ${c.color ? `<span style="color:#64748B; font-size:11.5px; margin-left:4px;">(${c.color})</span>` : ''}
          </div>
          <span style="font-size:11px; padding:2px 6px; border-radius:4px; font-weight:700; background:${statusBg}; color:${statusColor}; white-space:nowrap;">
            ${c.status || '-'}
          </span>
        </div>
      `;
    }).join("");
  },

  showMntCarDropdown(show = true) {
    const listEl = document.getElementById("mnt-car-dropdown-list");
    if (!listEl) return;
    if (show) {
      this.populateMaintenanceCars(document.getElementById("mnt-car-search-input")?.value || "");
      listEl.style.display = "block";
    } else {
      listEl.style.display = "none";
    }
  },

  toggleMntCarDropdown() {
    const listEl = document.getElementById("mnt-car-dropdown-list");
    if (!listEl) return;
    if (listEl.style.display === "none" || !listEl.style.display) {
      this.showMntCarDropdown(true);
      document.getElementById("mnt-car-search-input")?.focus();
    } else {
      this.showMntCarDropdown(false);
    }
  },

  filterMaintenanceCars(kw) {
    this.populateMaintenanceCars(kw);
    const listEl = document.getElementById("mnt-car-dropdown-list");
    if (listEl) listEl.style.display = "block";
  },

  selectMaintenanceCar(plate) {
    const car = (this.cars || []).find(c => c.plate === plate);
    const searchInput = document.getElementById("mnt-car-search-input");
    const carSel = document.getElementById("mnt-car-select");

    if (car) {
      if (searchInput) {
        searchInput.value = `${car.plate} - ${car.brand || ''} ${car.model || ''} (${car.color || ''})`;
      }
      if (carSel) {
        carSel.value = car.plate;
      }
      this.onMaintenanceCarSelected(car.plate);

      const isEdit = Boolean(document.getElementById("mnt-form-id")?.value);
      if (!isEdit) {
        const typeSel = document.getElementById("mnt-order-type");
        if (typeSel) {
          this.fetchAndPopulateLastCost(car.plate, typeSel.value);
        }
      }
    }
    this.showMntCarDropdown(false);
  },

  async fetchAndPopulateLastCost(carId, typeVal) {
    const costInput = document.getElementById("mnt-cost");
    const hintEl = document.getElementById("mnt-cost-hint");
    if (!costInput) return;
    if (!carId) {
      if (hintEl) hintEl.innerHTML = "";
      return;
    }

    if (hintEl) {
      hintEl.innerHTML = `<span style="color:#D97706;">⏳ กำลังตรวจสอบประวัติราคาเดิม...</span>`;
    }

    try {
      const resp = await fetch(`/api/maintenance/last-cost?car_id=${encodeURIComponent(carId)}&type=${encodeURIComponent(typeVal || "")}`);
      if (!resp.ok) {
        if (hintEl) hintEl.innerHTML = "";
        return;
      }
      const data = await resp.json();
      if (data && data.success && data.cost > 0) {
        costInput.value = data.cost;
        const sourceLabel = data.source === "maintenance_record"
          ? "ประวัติใบงานเดิมล่าสุด"
          : (data.source === "vehicle_maintenance" ? "ประวัติการซ่อมบำรุงเดิม" : "ค่าบริการตามสเปกรถ");
        if (hintEl) {
          hintEl.innerHTML = `<span style="color:#059669; font-weight:600;">💡 ดึงราคาล่าสุดอัตโนมัติ: ฿${Number(data.cost).toLocaleString()} (${sourceLabel}) — สามารถแก้ไขได้</span>`;
        }
      } else {
        costInput.value = 0;
        if (hintEl) {
          hintEl.innerHTML = `<span style="color:#64748B;">ไม่มีประวัติราคาเดิมในระบบ (กรุณาระบุงบประมาณตามจริง)</span>`;
        }
      }
    } catch (e) {
      console.warn("fetchAndPopulateLastCost error:", e);
      if (hintEl) hintEl.innerHTML = "";
    }
  },

  openNewMaintenanceModal(targetPlate = null, defaultType = null) {
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
    }

    document.getElementById("mnt-form-id").value = "";
    document.getElementById("mnt-cost").value = "";
    const hintEl = document.getElementById("mnt-cost-hint");
    if (hintEl) hintEl.innerHTML = "";
    document.getElementById("mnt-notes").value = "";
    const itemArea = document.getElementById("mnt-service-items");
    if (itemArea) itemArea.value = "";
    const gName = document.getElementById("mnt-service-center");
    if (gName) gName.value = "";
    const gPhone = document.getElementById("mnt-service-phone");
    if (gPhone) gPhone.value = "";
    const gLoc = document.getElementById("mnt-service-loc");
    if (gLoc) gLoc.value = "";
    const updateCarCheck = document.getElementById("mnt-update-car-status");
    if (updateCarCheck) updateCarCheck.checked = true;

    // Populate car options and select target
    this.populateMaintenanceCars("");
    const chosenPlate = targetPlate || (this.cars && this.cars[0] ? this.cars[0].plate : "");
    if (chosenPlate) {
      this.selectMaintenanceCar(chosenPlate);
    }

    const typeSel = document.getElementById("mnt-order-type");
    if (typeSel) {
      if (defaultType === "renewal") {
        typeSel.value = "ต่อทะเบียนภาษี และ พ.ร.บ.";
      } else {
        typeSel.value = "ซ่อมบำรุงทั่วไป / เช็คระยะ";
      }
      this.onMaintenanceTypeChange(typeSel.value);
    }

    const todayStr = new Date().toISOString().split("T")[0];
    const tomorrow = new Date(Date.now() + 86400000).toISOString().split("T")[0];

    const schedDate = document.getElementById("mnt-sched-date");
    if (schedDate) schedDate.value = todayStr;
    const expDate = document.getElementById("mnt-exp-date");
    if (expDate) expDate.value = tomorrow;

    document.getElementById("modal-mnt-title").textContent = "🛠️ ออกใบงานซ่อมบำรุง / ต่อทะเบียน-ประกัน";
    this.openModal("modal-new-maintenance");
  },

  openEditMaintenanceModal(mntId) {
    const rec = (this.maintenanceRecords || []).find(m => m.id === mntId);
    if (!rec) return;

    this.openNewMaintenanceModal(rec.car_id);

    document.getElementById("modal-mnt-title").textContent = `✏️ แก้ไขใบงานซ่อมบำรุง (${mntId})`;
    document.getElementById("mnt-form-id").value = mntId;
    document.getElementById("mnt-order-type").value = rec.order_type || "ซ่อมบำรุงทั่วไป / เช็คระยะ";
    document.getElementById("mnt-service-items").value = rec.service_items || "";
    document.getElementById("mnt-cost").value = rec.cost || "";
    const hintEl = document.getElementById("mnt-cost-hint");
    if (hintEl) {
      hintEl.innerHTML = `<span style="color:#64748B;">แก้ไขค่างบประมาณของใบงาน (${mntId})</span>`;
    }
    document.getElementById("mnt-mileage").value = rec.current_mileage || "";
    document.getElementById("mnt-service-center").value = rec.service_center || "";
    document.getElementById("mnt-service-phone").value = rec.service_center_phone || "";
    document.getElementById("mnt-service-loc").value = rec.service_location || "";
    document.getElementById("mnt-assigned-worker").value = rec.assigned_worker || "admin";
    document.getElementById("mnt-sched-date").value = this.dmyToYmd(rec.schedule_date) || (rec.schedule_date || "");
    document.getElementById("mnt-sched-time").value = rec.schedule_time || "09:00";
    document.getElementById("mnt-exp-date").value = this.dmyToYmd(rec.expected_finish_date) || (rec.expected_finish_date || "");
    document.getElementById("mnt-exp-time").value = rec.expected_finish_time || "17:00";
    document.getElementById("mnt-notes").value = rec.notes || "";
    const updateCarCheck = document.getElementById("mnt-update-car-status");
    if (updateCarCheck) updateCarCheck.checked = Boolean(rec.update_car_status);
  },

  onMaintenanceCarSelected(plate) {
    const car = (this.cars || []).find(c => c.plate === plate);
    if (!car) return;

    const actEl = document.getElementById("mnt-car-act");
    if (actEl) actEl.textContent = car.act_expiry || "-";
    const insEl = document.getElementById("mnt-car-ins");
    if (insEl) insEl.textContent = car.ins_expiry || "-";
    const mileEl = document.getElementById("mnt-mileage");
    if (mileEl) mileEl.value = car.mileage || "";
  },

  onMaintenanceTypeChange(typeVal) {
    const itemArea = document.getElementById("mnt-service-items");
    const garageInput = document.getElementById("mnt-service-center");
    if (itemArea) {
      if (typeVal.includes("ต่อทะเบียน") && (!itemArea.value || itemArea.value.includes("น้ำมันเครื่อง"))) {
        itemArea.value = "1. ตรวจสภาพรถยนต์ ตรอ.\n2. ยื่นต่อภาษีประจำปี ณ กรมการขนส่งทางบก\n3. จัดทำ พ.ร.บ. คุ้มครองผู้ประสบภัยจากรถ";
        if (garageInput && !garageInput.value) {
          garageInput.value = "สำนักงานขนส่งกรุงเทพมหานครพื้นที่ 5 (จตุจักร) / ตรอ.วิภาวดี";
        }
      } else if (typeVal.includes("ประกัน") && (!itemArea.value || itemArea.value.includes("น้ำมันเครื่อง"))) {
        itemArea.value = "1. ตรวจสอบเบี้ยประกันภัยรถยนต์ประจำปี\n2. ต่ออายุความคุ้มครองกรมธรรม์ประกันภัยรถยนต์ (ชั้น 1)";
      }
    }

    // Auto-fetch historical cost for the chosen car & order type if not in edit mode
    const isEdit = Boolean(document.getElementById("mnt-form-id")?.value);
    if (!isEdit) {
      const carSel = document.getElementById("mnt-car-select");
      const chosenPlate = carSel ? carSel.value : "";
      if (chosenPlate) {
        this.fetchAndPopulateLastCost(chosenPlate, typeVal);
      }
    }
  },

  appendMntItem(text) {
    const textarea = document.getElementById("mnt-service-items");
    if (!textarea) return;
    if (textarea.value.trim()) {
      textarea.value = textarea.value.trim() + "\n- " + text;
    } else {
      textarea.value = "- " + text;
    }
  },

  fillMntGarage(name, phone, loc) {
    const n = document.getElementById("mnt-service-center");
    if (n) n.value = name;
    const p = document.getElementById("mnt-service-phone");
    if (p) p.value = phone;
    const l = document.getElementById("mnt-service-loc");
    if (l) l.value = loc;
  },

  async submitMaintenanceOrder(openPdf = false) {
    const mntId = document.getElementById("mnt-form-id").value;
    const carId = document.getElementById("mnt-car-select").value;
    const orderType = document.getElementById("mnt-order-type").value;
    const serviceItems = document.getElementById("mnt-service-items").value.trim();
    const cost = document.getElementById("mnt-cost").value;
    const mileage = document.getElementById("mnt-mileage").value.trim();
    const serviceCenter = document.getElementById("mnt-service-center").value.trim();
    const servicePhone = document.getElementById("mnt-service-phone").value.trim();
    const serviceLoc = document.getElementById("mnt-service-loc").value.trim();
    const worker = document.getElementById("mnt-assigned-worker").value;
    const schedDate = document.getElementById("mnt-sched-date").value;
    const schedTime = document.getElementById("mnt-sched-time").value;
    const expDate = document.getElementById("mnt-exp-date").value;
    const expTime = document.getElementById("mnt-exp-time").value;
    const notes = document.getElementById("mnt-notes").value.trim();
    const updateCar = document.getElementById("mnt-update-car-status").checked;

    if (!carId) {
      alert("กรุณาเลือกรถยนต์ที่ต้องการดำเนินการ");
      return;
    }
    if (!serviceItems) {
      alert("กรุณาระบุรายการซ่อมหรือรายการบริการ");
      return;
    }

    const payload = {
      car_id: carId,
      order_type: orderType,
      service_items: serviceItems,
      cost: cost ? parseFloat(cost) : 0,
      current_mileage: mileage,
      service_center: serviceCenter || "ศูนย์บริการมาตรฐาน",
      service_center_phone: servicePhone || "-",
      service_location: serviceLoc || "-",
      assigned_worker: worker || "admin",
      schedule_date: schedDate,
      schedule_time: schedTime,
      expected_finish_date: expDate,
      expected_finish_time: expTime,
      notes: notes,
      update_car_status: updateCar,
      created_by: this.user?.name || this.user?.username || "Admin"
    };

    try {
      let res;
      if (mntId) {
        res = await fetch(`/api/maintenance/${mntId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
      } else {
        res = await fetch("/api/maintenance", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
      }

      const data = await res.json();
      if (data.success) {
        this.closeModal("modal-new-maintenance");
        const orderId = data.maintenance?.id || mntId;
        this.showToast(`🎉 ออกใบงาน ${orderId} สำเร็จเรียบร้อย!`, "success");
        await this.loadMaintenanceRecords();
        await this.loadCars();
        await this.loadBackOfficeJobs();

        if (openPdf && orderId) {
          window.open(`/api/pdf/maintenance/${orderId}`, "_blank");
        }
      } else {
        alert(data.detail || "บันทึกใบงานไม่สำเร็จ");
      }
    } catch (e) {
      alert("เกิดข้อผิดพลาด: " + e.message);
    }
  },

  openCloseMaintenanceModal(mntId) {
    const rec = (this.maintenanceRecords || []).find(m => m.id === mntId);
    if (!rec) return;

    const car = (this.cars || []).find(c => c.plate === rec.car_id) || {};
    const oType = String(rec.order_type || "");
    const isRenewal = oType.includes("ต่อทะเบียน") || oType.includes("พ.ร.บ.") || oType.includes("พรบ") || oType.includes("ประกัน") || oType.includes("ภาษี") || oType.includes("แพ็กคู่");

    document.getElementById("close-mnt-id").value = mntId;
    document.getElementById("close-mnt-car-title").textContent = `🚘 ${rec.car_id} (${rec.car_brand || car.brand || ''} ${rec.car_model || car.model || ''})`;
    document.getElementById("close-mnt-summary-txt").textContent = `ใบงาน: ${mntId} | ประเภท: ${rec.order_type} | ผู้รับผิดชอบ: ${rec.assigned_worker || '-'}`;
    document.getElementById("close-mnt-actual-cost").value = rec.actual_cost || rec.cost || "";
    document.getElementById("close-mnt-mileage").value = rec.current_mileage || car.mileage || "";
    document.getElementById("close-mnt-notes").value = rec.completion_notes || (isRenewal ? "ต่อภาษี/พ.ร.บ./ประกันภัยเรียบร้อย ได้รับเอกสารครบถ้วน" : "ตรวจรับรถเรียบร้อย สภาพสมบูรณ์พร้อมใช้งาน");
    document.getElementById("close-mnt-restore-car").checked = true;
    document.getElementById("close-mnt-record-expense").checked = true;

    const renewalSec = document.getElementById("close-mnt-renewal-section");
    const taxWrapper = document.getElementById("close-mnt-tax-wrapper");
    const actWrapper = document.getElementById("close-mnt-act-wrapper");
    const insWrapper = document.getElementById("close-mnt-ins-wrapper");
    const coWrapper = document.getElementById("close-mnt-company-wrapper");
    const submitBtn = document.getElementById("close-mnt-submit-btn");

    if (isRenewal) {
      if (renewalSec) renewalSec.style.display = "block";
      const hasTax = oType.includes("ภาษี") || oType.includes("ต่อทะเบียน") || oType.includes("แพ็กคู่");
      const hasAct = oType.includes("พ.ร.บ.") || oType.includes("พรบ") || oType.includes("ต่อทะเบียน") || oType.includes("แพ็กคู่");
      const hasIns = oType.includes("ประกัน") || oType.includes("แพ็กคู่");

      if (taxWrapper) taxWrapper.style.display = hasTax ? "block" : "none";
      if (actWrapper) actWrapper.style.display = hasAct ? "block" : "none";
      if (insWrapper) insWrapper.style.display = hasIns ? "block" : "none";
      if (coWrapper) coWrapper.style.display = (hasIns || isRenewal) ? "block" : "none";

      const curTax = car.tax_expiry || "-";
      const curAct = car.act_expiry || "-";
      const curIns = car.ins_expiry || "-";
      const taxCurrentEl = document.getElementById("close-mnt-tax-current");
      const actCurrentEl = document.getElementById("close-mnt-act-current");
      const insCurrentEl = document.getElementById("close-mnt-ins-current");
      if (taxCurrentEl) taxCurrentEl.textContent = `(วันหมดอายุเดิม: ${curTax})`;
      if (actCurrentEl) actCurrentEl.textContent = `(วันหมดอายุเดิม: ${curAct})`;
      if (insCurrentEl) insCurrentEl.textContent = `(วันหมดอายุเดิม: ${curIns})`;

      // Compute next 1 year default
      const nextTaxStr = this.computeRenewedDateStr(curTax);
      const nextActStr = this.computeRenewedDateStr(curAct);
      const nextInsStr = this.computeRenewedDateStr(curIns);

      const taxInput = document.getElementById("close-mnt-tax-expiry");
      const actInput = document.getElementById("close-mnt-act-expiry");
      const insInput = document.getElementById("close-mnt-ins-expiry");
      const coInput = document.getElementById("close-mnt-insurance-company");
      const policyInput = document.getElementById("close-mnt-policy-no");

      if (taxInput) taxInput.value = this.dmyToYmd(nextTaxStr);
      if (actInput) actInput.value = this.dmyToYmd(nextActStr);
      if (insInput) insInput.value = this.dmyToYmd(nextInsStr);
      if (coInput) coInput.value = car.insurance_company || car.ins_company || "";
      if (policyInput) policyInput.value = rec.policy_no || car.insurance_policy_no || car.policy_no || "";

      if (submitBtn) submitBtn.innerHTML = "🏁 ยืนยันส่งงาน & อัปเดตวันหมดอายุ";
    } else {
      if (renewalSec) renewalSec.style.display = "none";
      if (submitBtn) submitBtn.innerHTML = "🏁 ยืนยันตรวจรับรถ & ปิดงาน";
    }

    this.openModal("modal-close-maintenance");
  },

  async submitCloseMaintenance() {
    const mntId = document.getElementById("close-mnt-id").value;
    const actualCost = document.getElementById("close-mnt-actual-cost")?.value;
    const mileage = document.getElementById("close-mnt-mileage")?.value.trim() || "";
    const notes = document.getElementById("close-mnt-notes")?.value.trim() || "";

    const renewalSec = document.getElementById("close-mnt-renewal-section");
    const isRenewal = renewalSec && renewalSec.style.display !== "none";

    let newTaxExpiry = "";
    let newActExpiry = "";
    let newInsExpiry = "";
    let insuranceCompany = "";
    let policyNo = "";

    if (isRenewal) {
      const taxRaw = document.getElementById("close-mnt-tax-expiry")?.value;
      const actRaw = document.getElementById("close-mnt-act-expiry")?.value;
      const insRaw = document.getElementById("close-mnt-ins-expiry")?.value;
      insuranceCompany = document.getElementById("close-mnt-insurance-company")?.value.trim() || "";
      policyNo = document.getElementById("close-mnt-policy-no")?.value.trim() || "";

      const taxWrapper = document.getElementById("close-mnt-tax-wrapper");
      const actWrapper = document.getElementById("close-mnt-act-wrapper");
      const insWrapper = document.getElementById("close-mnt-ins-wrapper");

      if (taxWrapper && taxWrapper.style.display !== "none" && taxRaw) {
        newTaxExpiry = this.ymdToDmy(taxRaw);
      }
      if (actWrapper && actWrapper.style.display !== "none" && actRaw) {
        newActExpiry = this.ymdToDmy(actRaw);
      }
      if (insWrapper && insWrapper.style.display !== "none" && insRaw) {
        newInsExpiry = this.ymdToDmy(insRaw);
      }
    }

    if (!mntId) return;

    try {
      const res = await fetch(`/api/maintenance/${mntId}/close`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          actual_cost: actualCost ? parseFloat(actualCost) : 0,
          mileage: mileage,
          completion_notes: notes,
          new_tax_expiry: newTaxExpiry,
          new_act_expiry: newActExpiry,
          new_ins_expiry: newInsExpiry,
          insurance_company: insuranceCompany,
          policy_no: policyNo,
          recorded_by: this.user?.name || this.user?.username || "Admin"
        })
      });
      const data = await res.json();
      if (data.success) {
        this.closeModal("modal-close-maintenance");

        // Immediately update local car object for instant UI sync
        if (this.cars) {
          const rec = (this.maintenanceRecords || []).find(m => m.id === mntId);
          const c = rec ? this.cars.find(x => x.plate === rec.car_id) : null;
          if (c) {
            if (newTaxExpiry) { c.tax_expiry = newTaxExpiry; c.tax_expire_date = this.dmyToYmd(newTaxExpiry); }
            if (newActExpiry) { c.act_expiry = newActExpiry; c.prb_expire_date = this.dmyToYmd(newActExpiry); }
            if (newInsExpiry) { c.ins_expiry = newInsExpiry; c.insurance_expire_date = this.dmyToYmd(newInsExpiry); }
            if (insuranceCompany) { c.insurance_company = insuranceCompany; c.ins_company = insuranceCompany; }
            if (policyNo) {
              if (newActExpiry) { c.act_policy_no = policyNo; c.policy_no = policyNo; }
              else { c.insurance_policy_no = policyNo; c.ins_policy_no = policyNo; }
            }
            c.status = "ว่างพร้อมใช้งาน";
          }
        }

        let successMsg = `🏁 ปิดงาน ${mntId} เรียบร้อย!`;
        if (newTaxExpiry || newActExpiry || newInsExpiry) {
          const parts = [];
          if (newTaxExpiry) parts.push(`ภาษี: ${newTaxExpiry}`);
          if (newActExpiry) parts.push(`พ.ร.บ.: ${newActExpiry}`);
          if (newInsExpiry) parts.push(`ประกัน: ${newInsExpiry}`);
          successMsg = `🏁 ส่งงานสำเร็จ! อัปเดตข้อมูลรถเรียบร้อย (${parts.join(", ")})`;
        }
        this.showToast(successMsg, "success");
        await this.loadMaintenanceRecords();
        await this.loadCars();
        if (typeof this.renderCars === "function") {
          this.renderCars();
        } else {
          if (typeof this.renderFleetCards === "function") this.renderFleetCards();
          if (typeof this.renderFleetOverviewTable === "function") this.renderFleetOverviewTable();
        }
        if (typeof this.renderExpiringAlerts === "function") this.renderExpiringAlerts();
        if (typeof this.renderUnifiedExpensesTable === "function") this.renderUnifiedExpensesTable();
        await this.loadBackOfficeJobs();
        await this.loadDashboardKPIs();
        this.renderFleetOverviewTable();
      } else {
        alert(data.detail || "ปิดงานไม่สำเร็จ");
      }
    } catch (e) {
      alert("เกิดข้อผิดพลาด: " + e.message);
    }
  },

  async deleteMaintenanceRecord(mntId) {
    if (!confirm(`ยืนยันการลบใบงานซ่อมบำรุง ${mntId} ออกจากระบบถาวรใช่หรือไม่?`)) return;
    try {
      const res = await fetch(`/api/maintenance/${encodeURIComponent(mntId)}`, { method: "DELETE" });
      const data = await res.json();
      if (res.ok && data.success) {
        this.showToast(`✅ ลบใบงาน ${mntId} และคืนสถานะรถเรียบร้อย`, "success");
        await this.loadMaintenanceRecords();
        await this.loadCars();
        await this.loadBackOfficeJobs();
        try {
          if (this.loadDashboardKPIs) await this.loadDashboardKPIs();
          if (this.loadDashboardData) await this.loadDashboardData();
          if (this.renderDashboardCharts) this.renderDashboardCharts();
        } catch (dbErr) {
          console.warn("Dashboard refetch warning:", dbErr);
        }
      } else {
        alert(data.detail || data.message || "ลบใบงานไม่สำเร็จ");
      }
    } catch (e) {
      alert("เกิดข้อผิดพลาดในการลบใบงาน: " + e.message);
    }
  },

  async deleteWorkOrder(orderId) {
    if (!confirm(`ยืนยันการลบใบงาน ${orderId} ออกจากระบบถาวรใช่หรือไม่?`)) return;
    try {
      const res = await fetch(`/api/work-orders/${encodeURIComponent(orderId)}`, { method: "DELETE" });
      const data = await res.json();
      if (res.ok && data.success) {
        this.showToast(`✅ ลบใบงาน ${orderId} เรียบร้อย`, "success");
        await this.loadBackOfficeJobs();
        await this.loadMaintenanceRecords();
        await this.loadCars();
        try {
          if (this.loadDashboardKPIs) await this.loadDashboardKPIs();
          if (this.loadDashboardData) await this.loadDashboardData();
          if (this.renderDashboardCharts) this.renderDashboardCharts();
        } catch (dbErr) {
          console.warn("Dashboard refetch warning:", dbErr);
        }
      } else {
        alert(data.detail || data.message || "ลบใบงานไม่สำเร็จ");
      }
    } catch (e) {
      alert("เกิดข้อผิดพลาด: " + e.message);
    }
  }
});
