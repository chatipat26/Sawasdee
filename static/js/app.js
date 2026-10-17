/**
 * Sawasdee Rental - High-Speed SPA Application Logic
 */

class App {
  constructor() {
    this.user = JSON.parse(localStorage.getItem("sawasdee_user") || "null");
    this.cars = [];
    this.customers = [];
    this.bookings = [];
    this.backofficeJobs = [];
    this.completedJobs = [];
    this.users = [];
    this.activeModule = "frontoffice";
    this.activeTab = "fleet";
    this.uploadedPhotos = [];
    this.currentSelectedBooking = null;

    this.init();
  }

  async init() {
    this.setupDatePickers();
    this.updateAuthUI();
    await this.fetchInitialData();
    this.startLiveSyncPoller();
  }

  setupDatePickers() {
    const today = new Date().toISOString().split("T")[0];
    const next3 = new Date(Date.now() + 3 * 86400000).toISOString().split("T")[0];
    const sDate = document.getElementById("filter-start-date");
    const eDate = document.getElementById("filter-end-date");
    if (sDate && !sDate.value) sDate.value = today;
    if (eDate && !eDate.value) eDate.value = next3;
  }

  updateAuthUI() {
    const badge = document.getElementById("user-profile-badge");
    const loginBtn = document.getElementById("btn-open-login");
    const nameTxt = document.getElementById("user-display-name");
    const roleTag = document.getElementById("user-role-tag");
    const navUsers = document.getElementById("nav-users");

    if (this.user) {
      if (badge) badge.style.display = "flex";
      if (loginBtn) loginBtn.style.display = "none";
      if (nameTxt) nameTxt.textContent = this.user.name || this.user.username;
      if (roleTag) {
        roleTag.textContent = this.user.role;
        roleTag.style.background = this.user.role === "Admin" ? "#FEF3C7" : "#EFF6FF";
        roleTag.style.color = this.user.role === "Admin" ? "#92400E" : "#1E40AF";
      }
      if (navUsers) {
        navUsers.style.display = (this.user.role === "Admin" || this.user.username.toLowerCase() === "admin") ? "flex" : "none";
      }
    } else {
      if (badge) badge.style.display = "none";
      if (loginBtn) loginBtn.style.display = "inline-flex";
      if (navUsers) navUsers.style.display = "none";
    }
  }

  async fetchInitialData() {
    try {
      await Promise.all([
        this.loadCars(),
        this.loadCustomers(),
        this.loadBookings(),
        this.loadBackOfficeJobs(),
        this.loadDashboardKPIs()
      ]);
      this.onFilterChange();
    } catch (e) {
      console.error("Initial load error:", e);
    }
  }

  startLiveSyncPoller() {
    setInterval(async () => {
      try {
        const res = await fetch("/api/status");
        if (res.ok) {
          const st = await res.json();
          const syncTxt = document.getElementById("sync-time-txt");
          if (syncTxt) syncTxt.textContent = st.last_sync_formatted || "เมื่อสักครู่";
        }
      } catch (e) {}
    }, 10000);
  }

  async manualSync() {
    this.showToast("🔄 กำลังซิงค์ข้อมูลกับ Supabase Cloud...", "info");
    try {
      const res = await fetch("/api/sync", { method: "POST" });
      const data = await res.json();
      if (data.success) {
        await this.fetchInitialData();
        this.showToast("✅ ซิงค์ข้อมูลล่าสุดสำเร็จเรียบร้อย!", "success");
      }
    } catch (e) {
      this.showToast("⚠️ การซิงค์ขัดข้อง: " + e.message, "danger");
    }
  }

  // --- API Loaders ---
  async loadCars() {
    const sDate = document.getElementById("filter-start-date")?.value;
    const eDate = document.getElementById("filter-end-date")?.value;
    const url = `/api/cars?start_date=${sDate || ''}&end_date=${eDate || ''}`;
    const res = await fetch(url);
    if (res.ok) {
      this.cars = await res.json();
      this.renderFleetCards();
      this.renderFleetOverviewTable();
    }
  }

  async loadCustomers() {
    const res = await fetch("/api/customers");
    if (res.ok) {
      this.customers = await res.json();
      const badge = document.getElementById("badge-customers-count");
      if (badge) badge.textContent = this.customers.length;
      this.renderCustomersTable();
      this.populateCustomerDropdowns();
    }
  }

  async loadBookings() {
    const res = await fetch("/api/bookings");
    if (res.ok) {
      this.bookings = await res.json();
      const badge = document.getElementById("badge-frontoffice-bks");
      if (badge) badge.textContent = this.bookings.length;
      this.renderBookingsTable();
      this.populateBookingDropdowns();
    }
  }

  async loadBackOfficeJobs() {
    const res = await fetch("/api/backoffice/jobs");
    if (res.ok) {
      this.backofficeJobs = await res.json();
      const badge = document.getElementById("badge-backoffice-jobs");
      if (badge) badge.textContent = this.backofficeJobs.length;
      this.renderBackOfficeJobs();
    }
  }

  async loadDashboardKPIs() {
    try {
      const res = await fetch("/api/reports/kpis");
      if (res.ok) {
        const kpi = await res.json();
        document.getElementById("kpi-total-cars").textContent = kpi.total_cars;
        document.getElementById("kpi-active-rentals").textContent = kpi.active_rentals;
        document.getElementById("kpi-utilization").textContent = `${kpi.utilization_rate}%`;
        document.getElementById("kpi-total-revenue").textContent = `฿${kpi.total_revenue.toLocaleString('th-TH', {minimumFractionDigits: 2})}`;
      }
      this.loadMonthlyReports();
    } catch (e) {}
  }

  async loadMonthlyReports() {
    const mPicker = document.getElementById("report-month-picker");
    const mVal = mPicker ? mPicker.value : "";
    const url = mVal ? `/api/reports/monthly?month=${mVal}` : `/api/reports/monthly`;
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      this.completedJobs = data.jobs || [];
      this.renderCompletedJobsTable();
    }
  }

  async loadUsers() {
    const res = await fetch("/api/users");
    if (res.ok) {
      this.users = await res.json();
      this.renderUsersTable();
      const pendingCnt = this.users.filter(u => u.status === "pending").length;
      const bPending = document.getElementById("badge-pending-users");
      if (bPending) {
        bPending.style.display = pendingCnt > 0 ? "inline-block" : "none";
        bPending.textContent = pendingCnt;
      }
      this.populateStaffDropdowns();
    }
  }

  // --- UI Module Navigation ---
  switchModule(modName) {
    this.activeModule = modName;
    document.querySelectorAll(".nav-item").forEach(el => el.classList.remove("active"));
    const navBtn = document.getElementById(`nav-${modName}`);
    if (navBtn) navBtn.classList.add("active");

    ["frontoffice", "backoffice", "customers", "dashboard", "users"].forEach(m => {
      const sec = document.getElementById(`module-${m}`);
      if (sec) sec.style.display = (m === modName) ? "block" : "none";
    });

    if (modName === "backoffice") this.loadBackOfficeJobs();
    if (modName === "customers") this.renderCustomersTable();
    if (modName === "dashboard") this.loadDashboardKPIs();
    if (modName === "users") this.loadUsers();
  }

  switchTab(tabName) {
    this.activeTab = tabName;
    document.querySelectorAll(".tab-btn").forEach(el => el.classList.remove("active"));
    const tabBtn = document.getElementById(`tab-btn-${tabName}`);
    if (tabBtn) tabBtn.classList.add("active");

    ["fleet", "deposit", "assign", "contract", "dashboard_bks"].forEach(t => {
      const pane = document.getElementById(`subtab-${t}`);
      if (pane) pane.style.display = (t === tabName) ? "block" : "none";
    });
  }

  // --- Duration & Filter Engine ---
  calcDuration() {
    const sDate = document.getElementById("filter-start-date")?.value;
    const sTime = document.getElementById("filter-start-time")?.value || "10:00";
    const eDate = document.getElementById("filter-end-date")?.value;
    const eTime = document.getElementById("filter-end-time")?.value || "10:00";

    if (!sDate || !eDate) return { days: 1, text: "1 วัน" };

    const start = new Date(`${sDate}T${sTime}`);
    const end = new Date(`${eDate}T${eTime}`);
    if (end <= start) return { days: 1, text: "1 วัน (ขั้นต่ำ)" };

    const diffMs = end - start;
    const totalHours = Math.floor(diffMs / (1000 * 60 * 60));
    const remMins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
    const baseDays = Math.floor(totalHours / 24);
    const extraHours = totalHours % 24;

    let billableDays = baseDays;
    let desc = "";

    if (extraHours > 4 || (extraHours === 4 && remMins > 0)) {
      billableDays = baseDays + 1;
      desc = `${baseDays} วัน + เกินเวลา ${extraHours} ชม. ${remMins} น. (เกิน 4 ชม. ปรับเป็น 1 วัน ➔ คิด ${billableDays} วัน)`;
    } else {
      billableDays = Math.max(1, baseDays);
      if (extraHours > 0 || remMins > 0) {
        desc = `${baseDays} วัน + เกินเวลา ${extraHours} ชม. (อนุโลมไม่เกิน 4 ชม. ไม่คิดวันเพิ่ม ➔ คิด ${billableDays} วัน)`;
      } else {
        desc = `${billableDays} วันตรง (${billableDays * 24} ชั่วโมง)`;
      }
    }

    return { days: billableDays, text: desc };
  }

  onFilterChange() {
    const dur = this.calcDuration();
    const durTxt = document.getElementById("calc-duration-text");
    if (durTxt) durTxt.textContent = dur.text;

    this.renderFleetCards();
  }

  // --- Rendering: Fleet Cards ---
  renderFleetCards() {
    const container = document.getElementById("fleet-cards-container");
    if (!container) return;

    const companyFilter = document.getElementById("filter-company")?.value || "ทั้งหมด";
    const kw = (document.getElementById("filter-search-kw")?.value || "").toLowerCase().trim();
    const dur = this.calcDuration();

    const filtered = this.cars.filter(c => {
      if (companyFilter !== "ทั้งหมด" && c.company !== companyFilter) return false;
      if (kw) {
        const str = `${c.plate} ${c.brand} ${c.model} ${c.car_group} ${c.fuel_type}`.toLowerCase();
        if (!str.includes(kw)) return false;
      }
      return true;
    });

    const countTxt = document.getElementById("calc-cars-count");
    if (countTxt) {
      const availCount = filtered.filter(c => c.fleet_status_key === "available").length;
      countTxt.textContent = `พบรถว่างพร้อมให้บริการ: ${availCount} / ${filtered.length} คัน`;
    }

    if (filtered.length === 0) {
      container.innerHTML = `<div style="grid-column:1/-1; text-align:center; padding:40px; color:#64748B;">🔍 ไม่พบรถยนต์ตามเงื่อนไขที่เลือก</div>`;
      return;
    }

    container.innerHTML = filtered.map(c => {
      const isAvail = c.fleet_status_key === "available";
      const totalPrice = (c.price_day || 1000) * dur.days;
      const defImg = "https://images.unsplash.com/photo-1549399542-7e3f8b79c341?auto=format&fit=crop&q=80&w=500";
      const carImg = c.image || defImg;

      return `
        <div class="car-card">
          <div class="car-image-container">
            <img src="${carImg}" alt="${c.brand} ${c.model}" class="car-image" onerror="this.src='${defImg}'">
            <span class="car-status-pill" style="background:${c.status_bg}; color:${c.status_color}; border:1px solid ${c.status_border};">
              ${c.fleet_status_desc}
            </span>
          </div>
          <div class="car-body">
            <div class="car-title">${c.brand} ${c.model}</div>
            <div class="car-plate">🚘 ${c.plate}</div>
            <div class="car-specs">
              <span>💺 ${c.car_group || 'รถยนต์'}</span>
              <span>⛽ ${c.fuel_type || 'เบนซิน'}</span>
              <span>⚙️ ${c.engine_cc || '1500'} cc</span>
              <span>🏢 ${c.company || 'Sawasdee'}</span>
            </div>
            <div class="car-pricing">
              <div>
                <div style="font-size:11px; color:#64748B;">ค่าเช่า (${dur.days} วัน):</div>
                <div class="price-main">฿${totalPrice.toLocaleString()}</div>
              </div>
              <div>
                <button onclick="app.openBookModal('${c.plate}')" class="btn btn-sm ${isAvail ? 'btn-primary' : 'btn-secondary'}" ${!isAvail ? 'title="รถคันนี้ติดจอง แต่สามารถคลิกดูรายละเอียดหรือจองคิวต่อได้"' : ''}>
                  ${isAvail ? '⚡ จองทันที' : '📅 จองคิว'}
                </button>
              </div>
            </div>
          </div>
        </div>
      `;
    }).join("");
  }

  // --- Modal: Book Car ---
  openBookModal(plate) {
    const car = this.cars.find(c => c.plate === plate);
    if (!car) return;

    document.getElementById("book-car-plate").value = plate;
    const dur = this.calcDuration();
    const totalPrice = (car.price_day || 1000) * dur.days;

    document.getElementById("book-car-preview").innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <div>
          <b style="font-size:15px; color:#1E293B;">${car.brand} ${car.model}</b> | ทะเบียน: <b>${car.plate}</b><br/>
          <span style="font-size:12px; color:#64748B;">ระยะเวลา: ${dur.text}</span>
        </div>
        <div style="text-align:right;">
          <span style="font-size:11px; color:#64748B;">อัตราวันละ:</span><br/>
          <b style="font-size:16px; color:#D97706;">฿${(car.price_day || 1000).toLocaleString()}/วัน</b>
        </div>
      </div>
    `;

    document.getElementById("book-price-input").value = totalPrice;
    document.getElementById("book-discount-input").value = 0;
    document.getElementById("book-modal-net-price").textContent = `฿${totalPrice.toLocaleString('th-TH', {minimumFractionDigits: 2})}`;

    this.populateCustomerDropdowns();
    this.openModal("modal-book-car");
  }

  recalcBookingModalPrice() {
    const p = parseFloat(document.getElementById("book-price-input")?.value || 0);
    const d = parseFloat(document.getElementById("book-discount-input")?.value || 0);
    const net = Math.max(0, p - d);
    document.getElementById("book-modal-net-price").textContent = `฿${net.toLocaleString('th-TH', {minimumFractionDigits: 2})}`;
  }

  async submitInstantBooking() {
    const plate = document.getElementById("book-car-plate").value;
    const cust = document.getElementById("book-cust-select").value;
    const cType = document.getElementById("book-contract-type").value;
    const sDate = document.getElementById("filter-start-date").value;
    const sTime = document.getElementById("filter-start-time").value || "10:00";
    const eDate = document.getElementById("filter-end-date").value;
    const eTime = document.getElementById("filter-end-time").value || "10:00";
    const baseP = parseFloat(document.getElementById("book-price-input").value);
    const disc = parseFloat(document.getElementById("book-discount-input").value || 0);

    const payload = {
      car_id: plate,
      customer: cust,
      contract_type: cType,
      start_date: sDate,
      end_date: eDate,
      start_time: sTime,
      end_time: eTime,
      base_price: baseP,
      discount: disc,
      deposit_amount: 5000.0,
      created_by: this.user ? this.user.username : "admin"
    };

    try {
      const res = await fetch("/api/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (data.success) {
        this.closeModal("modal-book-car");
        this.showToast(`🎉 สร้างการจอง ${data.booking_id} เรียบร้อย!`, "success");
        await this.loadBookings();
        await this.loadCars();

        // Switch to Tab 2 (Deposit) and auto-select this booking
        this.switchTab("deposit");
        const sel = document.getElementById("deposit-sel-booking");
        if (sel) {
          sel.value = data.booking_id;
          this.onSelectDepositBooking();
        }
      }
    } catch (e) {
      this.showToast("เกิดข้อผิดพลาดในการสร้างการจอง: " + e.message, "danger");
    }
  }

  // --- Tab 2: Deposit & Settle Logic ---
  populateBookingDropdowns() {
    const depSel = document.getElementById("deposit-sel-booking");
    const assignDispSel = document.getElementById("assign-disp-bk");
    const assignRetSel = document.getElementById("assign-ret-bk");
    const contractSel = document.getElementById("contract-sel-bk");

    const activeBks = this.bookings.filter(b => b.status !== "ยกเลิก" && b.status !== "เสร็จสิ้น");

    const renderOpts = (bks) => `
      <option value="">-- กรุณาเลือกรายการจอง --</option>
      ${bks.map(b => `<option value="${b.booking_id}">${b.booking_id} | ${b.car_id} (${b.customer}) [สถานะ: ${b.status}]</option>`).join("")}
    `;

    if (depSel) depSel.innerHTML = renderOpts(activeBks);
    if (assignDispSel) assignDispSel.innerHTML = renderOpts(activeBks);
    if (assignRetSel) assignRetSel.innerHTML = renderOpts(activeBks);
    if (contractSel) contractSel.innerHTML = renderOpts(activeBks);
  }

  onSelectDepositBooking() {
    const bkId = document.getElementById("deposit-sel-booking").value;
    const summary = document.getElementById("deposit-booking-summary");
    const actionSec = document.getElementById("deposit-action-section");
    const btnSettle = document.getElementById("btn-settle-rental");
    const btnDlDep = document.getElementById("btn-dl-dep-receipt");
    const btnDlRent = document.getElementById("btn-dl-rent-receipt");

    if (!bkId) {
      if (summary) summary.style.display = "none";
      if (actionSec) actionSec.style.display = "none";
      return;
    }

    const b = this.bookings.find(x => x.booking_id === bkId);
    if (!b) return;

    this.currentSelectedBooking = b;
    summary.style.display = "block";
    actionSec.style.display = "block";

    const isDep = b.deposit_paid;
    const isRent = b.rental_paid;
    const netP = parseFloat(b.net_price || 0);

    summary.innerHTML = `
      <div style="font-size:13px; line-height:1.6;">
        <b style="color:#92400E; font-size:14px;">รหัส: ${b.booking_id}</b> | ทะเบียน: <b>${b.car_id}</b><br/>
        👤 ลูกค้า: <b>${b.customer}</b> (📞 ${b.customer_phone || '-'})<br/>
        📅 ระยะเวลา: ${b.start_date_formatted} ถึง ${b.end_date_formatted}<br/>
        💰 ค่าเช่าสุทธิ: <b style="color:#D97706; font-size:15px;">฿${netP.toLocaleString()}</b> |
        🛡️ มัดจำ: <b style="color:${isDep ? '#059669' : '#DC2626'};">${isDep ? 'ชำระแล้ว' : 'รอมัดจำ'}</b>
      </div>
    `;

    if (btnSettle) btnSettle.style.display = (!isRent && isDep) ? "inline-flex" : "none";
    if (btnDlDep) {
      btnDlDep.style.display = isDep ? "inline-flex" : "none";
      btnDlDep.onclick = () => window.open(`/api/pdf/deposit-receipt/${b.booking_id}`, "_blank");
    }
    if (btnDlRent) {
      btnDlRent.style.display = isRent ? "inline-flex" : "none";
      btnDlRent.onclick = () => window.open(`/api/pdf/receipt/${b.booking_id}`, "_blank");
    }
  }

  async submitDeposit() {
    if (!this.currentSelectedBooking) return;
    const bkId = this.currentSelectedBooking.booking_id;
    const depAmt = parseFloat(document.getElementById("deposit-amount-input").value);
    const depMethod = document.getElementById("deposit-method-input").value;
    const alsoRent = document.getElementById("deposit-also-rent").checked;

    try {
      const res = await fetch(`/api/bookings/${bkId}/deposit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deposit_amount: depAmt,
          payment_method: depMethod,
          also_pay_rental: alsoRent
        })
      });
      const data = await res.json();
      if (data.success) {
        this.showToast(`✅ บันทึกรับเงินมัดจำ ${bkId} เรียบร้อย!`, "success");
        await this.loadBookings();
        this.onSelectDepositBooking();
      }
    } catch (e) {
      this.showToast("เกิดข้อผิดพลาด: " + e.message, "danger");
    }
  }

  async submitSettle() {
    if (!this.currentSelectedBooking) return;
    const bkId = this.currentSelectedBooking.booking_id;
    const depMethod = document.getElementById("deposit-method-input").value;

    try {
      const res = await fetch(`/api/bookings/${bkId}/settle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payment_method: depMethod })
      });
      const data = await res.json();
      if (data.success) {
        this.showToast(`🎉 บันทึกชำระค่าเช่าคงเหลือ ${bkId} ครบถ้วน!`, "success");
        await this.loadBookings();
        this.onSelectDepositBooking();
      }
    } catch (e) {
      this.showToast("เกิดข้อผิดพลาด: " + e.message, "danger");
    }
  }

  // --- Tab 3: Dispatch & Return Assign ---
  populateStaffDropdowns() {
    const dispW = document.getElementById("assign-disp-worker");
    const retW = document.getElementById("assign-ret-worker");
    const approved = this.users.filter(u => u.status === "approved");
    const opts = approved.map(u => `<option value="${u.username}">${u.name || u.username} (${u.role})</option>`).join("");
    if (dispW) dispW.innerHTML = opts || `<option value="admin">ผู้ดูแลระบบ (admin)</option>`;
    if (retW) retW.innerHTML = opts || `<option value="admin">ผู้ดูแลระบบ (admin)</option>`;
  }

  onSelectAssignDispBooking() {
    const bkId = document.getElementById("assign-disp-bk").value;
    const form = document.getElementById("assign-disp-form");
    if (!bkId) { form.style.display = "none"; return; }
    form.style.display = "block";
    const b = this.bookings.find(x => x.booking_id === bkId);
    if (b) {
      if (b.loc_delivery) document.getElementById("assign-disp-loc").value = b.loc_delivery;
      if (b.start_time) document.getElementById("assign-disp-time").value = b.start_time;
      if (b.worker_delivery) document.getElementById("assign-disp-worker").value = b.worker_delivery;
    }
  }

  onSelectAssignRetBooking() {
    const bkId = document.getElementById("assign-ret-bk").value;
    const form = document.getElementById("assign-ret-form");
    if (!bkId) { form.style.display = "none"; return; }
    form.style.display = "block";
    const b = this.bookings.find(x => x.booking_id === bkId);
    if (b) {
      if (b.loc_return) document.getElementById("assign-ret-loc").value = b.loc_return;
      if (b.end_time) document.getElementById("assign-ret-time").value = b.end_time;
      if (b.worker_return) document.getElementById("assign-ret-worker").value = b.worker_return;
    }
  }

  async submitAssign(jobType) {
    const bkId = document.getElementById(jobType === "Dispatch" ? "assign-disp-bk" : "assign-ret-bk").value;
    const worker = document.getElementById(jobType === "Dispatch" ? "assign-disp-worker" : "assign-ret-worker").value;
    const loc = document.getElementById(jobType === "Dispatch" ? "assign-disp-loc" : "assign-ret-loc").value;
    const tVal = document.getElementById(jobType === "Dispatch" ? "assign-disp-time" : "assign-ret-time").value;

    try {
      const res = await fetch(`/api/bookings/${bkId}/assign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          job_type: jobType,
          worker: worker,
          location: loc,
          time: tVal
        })
      });
      const data = await res.json();
      if (data.success) {
        this.showToast(`✅ บันทึกมอบหมายงาน ${jobType} และแจ้งเตือน LINE เรียบร้อย!`, "success");
        await this.loadBookings();
        await this.loadBackOfficeJobs();
      }
    } catch (e) {
      this.showToast("เกิดข้อผิดพลาด: " + e.message, "danger");
    }
  }

  // --- Tab 4: Contract Formulation ---
  onSelectContractBooking() {
    const bkId = document.getElementById("contract-sel-bk").value;
    const card = document.getElementById("contract-details-card");
    if (!bkId) { card.style.display = "none"; return; }

    const b = this.bookings.find(x => x.booking_id === bkId);
    if (!b) return;

    card.style.display = "block";
    const cust = this.customers.find(c => c.full_name === b.customer) || {};
    const car = this.cars.find(c => c.plate === b.car_id) || {};

    document.getElementById("contract-cust-info").innerHTML = `
      • <b>ชื่อ:</b> ${b.customer}<br/>
      • <b>Passport/ID:</b> ${cust.passport_id || '-'}<br/>
      • <b>เบอร์โทร:</b> ${cust.contact_no || '-'}<br/>
      • <b>ใบขับขี่:</b> ${cust.licence_no || '-'}
    `;

    document.getElementById("contract-car-info").innerHTML = `
      • <b>ทะเบียน:</b> ${b.car_id}<br/>
      • <b>รุ่น:</b> ${car.brand || ''} ${car.model || ''}<br/>
      • <b>สี:</b> ${car.color || '-'}<br/>
      • <b>บริษัท:</b> ${car.company || '-'}
    `;

    document.getElementById("contract-sched-info").innerHTML = `
      • <b>เริ่ม:</b> ${b.start_date_formatted} (${b.start_time || '10:00'})<br/>
      • <b>คืน:</b> ${b.end_date_formatted} (${b.end_time || '10:00'})<br/>
      • <b>พนักงานส่ง:</b> ${b.worker_delivery || 'รอมอบหมาย'}
    `;

    const netP = parseFloat(b.net_price || 0);
    const remP = parseFloat(b.remaining_rental || (b.rental_paid ? 0 : netP));
    document.getElementById("contract-net-price").textContent = `฿${netP.toLocaleString()}`;
    document.getElementById("contract-dep-status").textContent = b.deposit_paid ? "ชำระแล้ว (฿5,000)" : "รอมัดจำ";
    document.getElementById("contract-rem-price").textContent = `฿${remP.toLocaleString()}`;

    const btnDl = document.getElementById("btn-dl-contract-pdf");
    if (btnDl) btnDl.href = `/api/pdf/contract/${b.booking_id}`;

    const btnRc = document.getElementById("btn-dl-contract-receipt");
    if (btnRc) btnRc.href = `/api/pdf/receipt/${b.booking_id}`;
  }

  async markContractIssued() {
    const bkId = document.getElementById("contract-sel-bk").value;
    if (!bkId) return;
    try {
      await fetch(`/api/bookings/${bkId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contract_issued: true })
      });
      this.showToast("✅ บันทึกสถานะออกสัญญาเช่าเรียบร้อย!", "success");
      await this.loadBookings();
    } catch (e) {}
  }

  // --- Tab 5: Bookings Table ---
  renderBookingsTable() {
    const tbody = document.getElementById("bookings-table-body");
    if (!tbody) return;

    const kw = (document.getElementById("bks-search-input")?.value || "").toLowerCase().trim();
    const stFilter = document.getElementById("bks-status-filter")?.value || "ทั้งหมด";

    const filtered = this.bookings.filter(b => {
      if (stFilter !== "ทั้งหมด" && b.status !== stFilter) return false;
      if (kw) {
        const s = `${b.booking_id} ${b.car_id} ${b.customer} ${b.status}`.toLowerCase();
        if (!s.includes(kw)) return false;
      }
      return true;
    });

    if (filtered.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; padding:30px; color:#64748B;">ไม่พบรายการจอง</td></tr>`;
      return;
    }

    tbody.innerHTML = filtered.map(b => {
      const isDep = b.deposit_paid;
      const isRent = b.rental_paid;
      const netP = parseFloat(b.net_price || 0);

      let depBadge = isDep ? '<span class="badge badge-success">มัดจำแล้ว</span>' : '<span class="badge badge-warning">รอมัดจำ</span>';
      let rentBadge = isRent ? '<span class="badge badge-success">จ่ายครบ</span>' : '<span class="badge badge-danger">ค้างชำระ</span>';

      return `
        <tr>
          <td>
            <b style="color:#D97706;">${b.booking_id}</b>
          </td>
          <td>
            <b>${b.car_id}</b><br/>
            <span style="font-size:11px; color:#64748B;">${b.car_brand || ''} ${b.car_model || ''}</span>
          </td>
          <td>
            <b>${b.customer}</b><br/>
            <span style="font-size:11px; color:#64748B;">📞 ${b.customer_phone || '-'}</span>
          </td>
          <td style="font-size:12px;">
            ${b.start_date_formatted} (${b.start_time || '10:00'})<br/>
            ถึง ${b.end_date_formatted} (${b.end_time || '10:00'})
          </td>
          <td style="font-weight:700; color:#1E293B;">
            ฿${netP.toLocaleString()}
          </td>
          <td>
            ${depBadge} ${rentBadge}
          </td>
          <td>
            <span class="badge badge-info">${b.status}</span>
          </td>
          <td style="text-align:center; white-space:nowrap;">
            <a href="/api/pdf/contract/${b.booking_id}" target="_blank" class="btn btn-sm btn-secondary" title="สัญญาเช่า PDF">📝</a>
            <a href="/api/pdf/receipt/${b.booking_id}" target="_blank" class="btn btn-sm btn-secondary" title="ใบเสร็จค่าเช่า PDF">🧾</a>
            <button onclick="app.deleteBooking('${b.booking_id}')" class="btn btn-sm btn-danger" title="ลบรายการจอง">🗑️</button>
          </td>
        </tr>
      `;
    }).join("");
  }

  async deleteBooking(bkId) {
    if (!confirm(`คุณแน่ใจหรือไม่ว่าต้องการลบรายการจอง ${bkId}?`)) return;
    try {
      const res = await fetch(`/api/bookings/${bkId}`, { method: "DELETE" });
      const data = await res.json();
      if (data.success) {
        this.showToast(`ลบรายการจอง ${bkId} เรียบร้อย`, "success");
        await this.loadBookings();
        await this.loadCars();
      }
    } catch (e) {
      this.showToast("ลบไม่สำเร็จ: " + e.message, "danger");
    }
  }

  // --- Back Office Rendering ---
  renderBackOfficeJobs() {
    const tbody = document.getElementById("backoffice-jobs-tbody");
    if (!tbody) return;

    const kw = (document.getElementById("bo-search-input")?.value || "").toLowerCase().trim();
    const filtered = this.backofficeJobs.filter(j => {
      if (kw) {
        const s = `${j.booking_id} ${j.car_id} ${j.customer} ${j.job_type}`.toLowerCase();
        if (!s.includes(kw)) return false;
      }
      return true;
    });

    if (filtered.length === 0) {
      tbody.innerHTML = `<tr><td colspan="9" style="text-align:center; padding:30px; color:#64748B;">📋 ไม่มีใบงานในระบบขณะนี้</td></tr>`;
      return;
    }

    tbody.innerHTML = filtered.map(j => {
      const isDisp = j.job_type === "Dispatch";
      const typeBadge = isDisp ? '<span class="badge badge-info">🚚 ส่งมอบรถ (Dispatch)</span>' : '<span class="badge badge-warning">🔙 รับรถคืน (Return)</span>';

      return `
        <tr>
          <td>${typeBadge}</td>
          <td><b style="color:#D97706;">${j.booking_id}</b></td>
          <td><b>${j.car_id}</b></td>
          <td>
            <b>${j.customer}</b><br/>
            ${j.customer_phone && j.customer_phone !== '-' ? `<a href="tel:${j.customer_phone}" style="color:#2563EB; font-size:11.5px; text-decoration:none;">📞 ${j.customer_phone}</a>` : ''}
          </td>
          <td style="font-size:12px;">${j.schedule}</td>
          <td><span style="font-weight:600; color:#334155;">${j.worker}</span></td>
          <td style="max-width:140px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${j.location}">
            ${j.location.startsWith("http") ? `<a href="${j.location}" target="_blank" style="color:#2563EB;">📍 แผนที่นัดหมาย</a>` : j.location}
          </td>
          <td><span class="badge badge-gray">${j.status}</span></td>
          <td style="text-align:center; white-space:nowrap;">
            <a href="/api/pdf/job/${j.booking_id}" target="_blank" class="btn btn-sm btn-secondary" title="ใบตรวจสภาพ PDF">📋</a>
            <button onclick="app.openHandoverModal('${j.booking_id}', '${j.job_type}')" class="btn btn-sm btn-primary" ${j.is_locked ? 'disabled title="ต้องปิดงานส่งมอบก่อน"' : ''}>
              🔍 ตรวจรับส่ง & ปิดงาน
            </button>
          </td>
        </tr>
      `;
    }).join("");
  }

  // --- Modal: Handover Inspection ---
  openHandoverModal(bkId, jobType) {
    document.getElementById("insp-bk-id").value = bkId;
    document.getElementById("insp-job-type").value = jobType;
    document.getElementById("modal-handover-title").textContent = jobType === "Dispatch"
      ? `🚚 ตรวจสภาพและส่งมอบรถ (Dispatch - ${bkId})`
      : `🔙 ตรวจสภาพและรับรถคืน (Return - ${bkId})`;

    this.uploadedPhotos = [];
    document.getElementById("insp-uploaded-photos").innerHTML = "";
    this.openModal("modal-handover");
  }

  async handlePhotoUpload(input) {
    if (!input.files || input.files.length === 0) return;
    const container = document.getElementById("insp-uploaded-photos");

    for (let file of input.files) {
      const formData = new FormData();
      formData.append("file", file);

      try {
        this.showToast(`กำลังอัปโหลด ${file.name}...`, "info");
        const res = await fetch("/api/upload-photo", { method: "POST", body: formData });
        const data = await res.json();
        if (data.success) {
          this.uploadedPhotos.push(data.url);
          const thumb = document.createElement("img");
          thumb.src = data.url;
          thumb.style.width = "50px";
          thumb.style.height = "50px";
          thumb.style.objectFit = "cover";
          thumb.style.borderRadius = "6px";
          thumb.style.border = "1px solid #CBD5E1";
          container.appendChild(thumb);
          this.showToast(`📸 อัปโหลดรูปภาพสำเร็จ!`, "success");
        }
      } catch (e) {
        this.showToast("อัปโหลดไม่สำเร็จ: " + e.message, "danger");
      }
    }
  }

  async submitInspection() {
    const bkId = document.getElementById("insp-bk-id").value;
    const jobType = document.getElementById("insp-job-type").value;
    const fuel = document.getElementById("insp-fuel-select").value;
    const mileage = document.getElementById("insp-mileage-input").value;
    const notes = document.getElementById("insp-notes-input").value;

    const payload = {
      fuel_level: fuel,
      mileage: mileage,
      notes: notes,
      photos: this.uploadedPhotos
    };

    const endpoint = jobType === "Dispatch" ? `/api/bookings/${bkId}/close-dispatch` : `/api/bookings/${bkId}/close-return`;

    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (data.success) {
        this.closeModal("modal-handover");
        this.showToast(`🎉 ปิดงาน ${jobType} สำหรับ ${bkId} สมบูรณ์!`, "success");
        await this.loadBackOfficeJobs();
        await this.loadBookings();
        await this.loadCars();
        if (jobType === "Return") await this.loadDashboardKPIs();
      }
    } catch (e) {
      this.showToast("เกิดข้อผิดพลาด: " + e.message, "danger");
    }
  }

  // --- Customers Table & Add Modal ---
  renderCustomersTable() {
    const tbody = document.getElementById("customers-table-tbody");
    if (!tbody) return;

    const kw = (document.getElementById("cust-search-input")?.value || "").toLowerCase().trim();
    const filtered = this.customers.filter(c => {
      if (kw) {
        const s = `${c.full_name} ${c.contact_no} ${c.passport_id} ${c.licence_no}`.toLowerCase();
        if (!s.includes(kw)) return false;
      }
      return true;
    });

    tbody.innerHTML = filtered.map(c => `
      <tr>
        <td><b>${c.full_name}</b></td>
        <td>
          📞 ${c.contact_no || '-'}<br/>
          ${c.whatsapp && c.whatsapp !== '-' ? `<span style="font-size:11px; color:#10B981;">WA: ${c.whatsapp}</span>` : ''}
        </td>
        <td>${c.passport_id || '-'}</td>
        <td>${c.licence_no || '-'}</td>
        <td>${c.nationality || 'THAI'}</td>
        <td style="max-width:180px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${c.thai_address}">${c.thai_address || '-'}</td>
        <td style="text-align:center;">
          <button onclick="app.deleteCustomer('${c.full_name}')" class="btn btn-sm btn-danger">🗑️</button>
        </td>
      </tr>
    `).join("");
  }

  populateCustomerDropdowns() {
    const sel = document.getElementById("book-cust-select");
    if (sel) {
      sel.innerHTML = this.customers.map(c => `<option value="${c.full_name}">${c.full_name} (📞 ${c.contact_no || '-'})</option>`).join("");
    }
  }

  openAddCustomerModal() {
    this.openModal("modal-add-customer");
  }

  async submitNewCustomer() {
    const name = document.getElementById("cust-name-in")?.value.trim();
    if (!name) {
      alert("กรุณาระบุชื่อ-นามสกุลลูกค้า");
      return;
    }

    const payload = {
      full_name: name,
      contact_no: document.getElementById("cust-phone-in")?.value.trim() || "-",
      passport_id: document.getElementById("cust-pass-in")?.value.trim() || "-",
      licence_no: document.getElementById("cust-lic-in")?.value.trim() || "-",
      nationality: document.getElementById("cust-nat-in")?.value.trim() || "THAI",
      whatsapp: document.getElementById("cust-wa-in")?.value.trim() || "-",
      dob: document.getElementById("cust-dob-in")?.value || "1990-01-01",
      licence_expiry: document.getElementById("cust-licexp-in")?.value || "2030-01-01",
      home_address: document.getElementById("cust-home-in")?.value.trim() || "-",
      thai_address: document.getElementById("cust-thai-in")?.value.trim() || "-"
    };

    try {
      const res = await fetch("/api/customers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (data.success) {
        this.closeModal("modal-add-customer");
        this.showToast(`🎉 บันทึกข้อมูลลูกค้า '${name}' เรียบร้อย!`, "success");
        await this.loadCustomers();
      }
    } catch (e) {
      this.showToast("บันทึกไม่สำเร็จ: " + e.message, "danger");
    }
  }

  async deleteCustomer(name) {
    if (!confirm(`คุณแน่ใจหรือไม่ว่าต้องการลบข้อมูลลูกค้า '${name}'?`)) return;
    try {
      const res = await fetch(`/api/customers/${encodeURIComponent(name)}`, { method: "DELETE" });
      const data = await res.json();
      if (data.success) {
        this.showToast(`ลบข้อมูลลูกค้า '${name}' เรียบร้อย`, "success");
        await this.loadCustomers();
      }
    } catch (e) {
      this.showToast("ลบไม่สำเร็จ: " + e.message, "danger");
    }
  }

  // --- Executive Dashboard Rendering ---
  renderFleetOverviewTable() {
    const tbody = document.getElementById("fleet-overview-tbody");
    if (!tbody) return;

    tbody.innerHTML = this.cars.map(c => `
      <tr>
        <td><b>🚘 ${c.plate}</b></td>
        <td>${c.brand} ${c.model}</td>
        <td>${c.company || 'Sawasdee'}</td>
        <td>
          <span class="badge" style="background:${c.status_bg}; color:${c.status_color}; border:1px solid ${c.status_border};">
            ${c.fleet_status_desc}
          </span>
        </td>
        <td>${c.act_expiry || '-'}</td>
        <td>${c.ins_expiry || '-'}</td>
        <td>${c.mileage || '15,000'} km</td>
      </tr>
    `).join("");
  }

  toggleFleetTableCollapse() {
    const wrap = document.getElementById("fleet-table-wrapper");
    const icon = document.getElementById("fleet-collapse-icon");
    if (!wrap) return;
    if (wrap.style.display === "none") {
      wrap.style.display = "block";
      if (icon) icon.textContent = "▲ คลิกเพื่อย่อ";
    } else {
      wrap.style.display = "none";
      if (icon) icon.textContent = "▼ คลิกเพื่อขยาย";
    }
  }

  renderCompletedJobsTable() {
    const tbody = document.getElementById("completed-jobs-tbody");
    if (!tbody) return;

    if (this.completedJobs.length === 0) {
      tbody.innerHTML = `<tr><td colspan="11" style="text-align:center; padding:30px; color:#64748B;">ยังไม่มีประวัติงานเสร็จสิ้นในเดือนที่เลือก</td></tr>`;
      return;
    }

    tbody.innerHTML = this.completedJobs.map(j => `
      <tr>
        <td><b style="color:#D97706;">${j.booking_id}</b></td>
        <td>📅 ${j.completed_date || j.end_date || '-'}</td>
        <td><b>${j.car_id}</b></td>
        <td><b>${j.customer}</b></td>
        <td>${j.company || '-'}</td>
        <td><span class="badge badge-gray">${j.contract_type || 'รายวัน'}</span></td>
        <td style="font-weight:700; color:#059669;">฿${parseFloat(j.net_price || 0).toLocaleString()}</td>
        <td style="font-size:12px;">${j.worker_delivery || '-'} / ${j.worker_return || '-'}</td>
        <td style="font-size:12px;">${j.fuel_level || '-'}</td>
        <td><span class="badge badge-success">เสร็จสิ้น</span></td>
        <td style="text-align:center; white-space:nowrap;">
          <a href="/api/pdf/contract/${j.booking_id}" target="_blank" class="btn btn-sm btn-secondary" title="สัญญา">📝</a>
          <a href="/api/pdf/receipt/${j.booking_id}" target="_blank" class="btn btn-sm btn-secondary" title="ใบเสร็จ">🧾</a>
          <a href="/api/pdf/job/${j.booking_id}" target="_blank" class="btn btn-sm btn-secondary" title="ใบตรวจสภาพ">📋</a>
        </td>
      </tr>
    `).join("");
  }

  async triggerLineExpiryCheck() {
    this.showToast("📲 กำลังตรวจสอบวันหมดอายุ พ.ร.บ./ประกันภัย และส่ง LINE...", "info");
    try {
      const res = await fetch("/api/line/check-expiry", { method: "POST" });
      const data = await res.json();
      if (data.sent) {
        this.showToast(`🚨 ส่งการแจ้งเตือนทาง LINE สำเร็จ: ${data.count} รายการ!`, "success");
      } else {
        this.showToast(data.message || "ไม่มีรายการครบกำหนดแจ้งเตือนในวันนี้", "info");
      }
    } catch (e) {
      this.showToast("เกิดข้อผิดพลาด: " + e.message, "danger");
    }
  }

  // --- Admin Users Rendering ---
  renderUsersTable() {
    const tbody = document.getElementById("users-table-tbody");
    if (!tbody) return;

    tbody.innerHTML = this.users.map(u => {
      const isPending = u.status === "pending";
      return `
        <tr>
          <td><b>${u.username}</b></td>
          <td>${u.name || '-'}</td>
          <td><span class="badge badge-info">${u.role || 'Staff'}</span></td>
          <td>
            <span class="badge ${isPending ? 'badge-danger' : 'badge-success'}">
              ${isPending ? '⏳ รออนุมัติ' : '✅ ใช้งานได้'}
            </span>
          </td>
          <td style="text-align:center; white-space:nowrap;">
            ${isPending ? `<button onclick="app.approveUser('${u.username}')" class="btn btn-sm btn-success">อนุมัติ</button>` : `<button onclick="app.rejectUser('${u.username}')" class="btn btn-sm btn-secondary">ระงับ</button>`}
            ${u.username !== 'admin' ? `<button onclick="app.deleteUser('${u.username}')" class="btn btn-sm btn-danger">ลบ</button>` : ''}
          </td>
        </tr>
      `;
    }).join("");
  }

  async approveUser(un) {
    await fetch(`/api/users/${un}/approve`, { method: "POST" });
    this.showToast(`อนุมัติผู้ใช้ ${un} เรียบร้อย`, "success");
    await this.loadUsers();
  }

  async rejectUser(un) {
    await fetch(`/api/users/${un}/reject`, { method: "POST" });
    this.showToast(`ระงับสิทธิ์ ${un} เรียบร้อย`, "info");
    await this.loadUsers();
  }

  async deleteUser(un) {
    if (!confirm(`ต้องการลบบัญชี ${un}?`)) return;
    await fetch(`/api/users/${un}`, { method: "DELETE" });
    this.showToast(`ลบบัญชี ${un} เรียบร้อย`, "success");
    await this.loadUsers();
  }

  // --- Auth Dialog & Session ---
  openLoginModal() {
    this.openModal("modal-login");
  }

  toggleAuthMode(mode) {
    const loginBox = document.getElementById("auth-login-box");
    const regBox = document.getElementById("auth-reg-box");
    const title = document.getElementById("auth-title");
    if (mode === "register") {
      loginBox.style.display = "none";
      regBox.style.display = "block";
      title.textContent = "📝 ลงทะเบียนพนักงานใหม่";
    } else {
      loginBox.style.display = "block";
      regBox.style.display = "none";
      title.textContent = "🔑 เข้าสู่ระบบ Sawasdee Rental";
    }
  }

  async submitLogin() {
    const un = document.getElementById("login-username").value.trim();
    const pw = document.getElementById("login-password").value.trim();
    if (!un || !pw) {
      alert("กรุณากรอกชื่อผู้ใช้และรหัสผ่าน");
      return;
    }

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: un, password: pw })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "เข้าสู่ระบบไม่สำเร็จ");

      this.user = data.user;
      localStorage.setItem("sawasdee_user", JSON.stringify(this.user));
      this.updateAuthUI();
      this.closeModal("modal-login");
      this.showToast(`🎉 ยินดีต้อนรับคุณ ${this.user.name || this.user.username}!`, "success");
    } catch (e) {
      alert(e.message);
    }
  }

  async submitRegister() {
    const un = document.getElementById("reg-username").value.trim();
    const fn = document.getElementById("reg-name").value.trim();
    const pw = document.getElementById("reg-password").value.trim();
    if (!un || !pw) {
      alert("กรุณากรอกข้อมูลให้ครบถ้วน");
      return;
    }

    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: un, name: fn, password: pw })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "ลงทะเบียนไม่สำเร็จ");

      alert(data.message || "ลงทะเบียนสำเร็จ กรุณารอแอดมินอนุมัติ");
      this.toggleAuthMode("login");
    } catch (e) {
      alert(e.message);
    }
  }

  logout() {
    this.user = null;
    localStorage.removeItem("sawasdee_user");
    this.updateAuthUI();
    this.showToast("ออกจากระบบเรียบร้อย", "info");
  }

  // --- Modal & Toast Helpers ---
  openModal(modalId) {
    const m = document.getElementById(modalId);
    if (m) m.classList.add("open");
  }

  closeModal(modalId) {
    const m = document.getElementById(modalId);
    if (m) m.classList.remove("open");
  }

  showToast(message, type = "info") {
    const container = document.getElementById("toast-container");
    if (!container) return;

    const toast = document.createElement("div");
    toast.className = "toast";
    let icon = "ℹ️";
    if (type === "success") icon = "✅";
    if (type === "danger") icon = "⚠️";

    toast.innerHTML = `<span>${icon}</span> <span>${message}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = "0";
      toast.style.transition = "opacity 0.3s ease";
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  }
}

// Global App Instance
const app = new App();
window.app = app;
