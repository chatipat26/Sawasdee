/**
 * Sawasdee Rental - API Data Loaders & Live Sync Poller
 * Prototype Mixin for App
 */
Object.assign(App.prototype, {
  async fetchInitialData() {
    try {
      await Promise.all([
        this.loadUsers().catch(e => console.error("loadUsers err:", e)),
        this.loadCars().catch(e => console.error("loadCars err:", e)),
        this.loadCustomers().catch(e => console.error("loadCustomers err:", e)),
        this.loadBookings().catch(e => console.error("loadBookings err:", e)),
        this.loadBackOfficeJobs().catch(e => console.error("loadBackOfficeJobs err:", e)),
        this.loadMaintenanceRecords().catch(e => console.error("loadMaintenance err:", e)),
        this.loadDashboardKPIs().catch(e => console.error("loadDashboardKPIs err:", e)),
        this.loadHpLeasingData().catch(e => console.error("loadHpLeasing err:", e))
      ]);
      this.onFilterChange();
    } catch (e) {
      console.error("Initial load error:", e);
      try {
        this.onFilterChange();
      } catch (err2) {}
    }
  },

  startLiveSyncPoller() {
    setInterval(async () => {
      try {
        if (this.checkSessionTimeout()) return;
        const res = await fetch("/api/status");
        if (res.ok) {
          const st = await res.json();
          const syncTxt = document.getElementById("sync-time-txt");
          if (syncTxt) syncTxt.textContent = st.last_sync_formatted || "เมื่อสักครู่";
          if (st.data_signature && this.lastDataSignature && st.data_signature !== this.lastDataSignature) {
            this.lastDataSignature = st.data_signature;
            await this.fetchInitialData();
          } else if (st.data_signature && !this.lastDataSignature) {
            this.lastDataSignature = st.data_signature;
            if (typeof st.total_bookings === "number" && st.total_bookings !== this.bookings.length) {
              await this.fetchInitialData();
            }
          }
        }
      } catch (e) {}
    }, 8000);
  },

  async manualSync() {
    this.showToast("🔄 กำลังซิงค์ข้อมูลกับฐานข้อมูล PostgreSQL...", "info");
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
  },

  async loadCars() {
    const sDate = document.getElementById("filter-start-date")?.value;
    const eDate = document.getElementById("filter-end-date")?.value;
    const url = `/api/cars?start_date=${sDate || ''}&end_date=${eDate || ''}`;
    const res = await fetch(url);
    if (res.ok) {
      this.cars = await res.json();
      this.populateFleetDropdowns();
      this.populateCarFormCreatableSelects();
      this.renderFleetCards();
      this.renderFleetOverviewTable();
      if (this.activeModule === "dashboard") {
        this.renderDashboardCharts();
      }
    }
  },

  async loadCustomers() {
    const res = await fetch("/api/customers");
    if (res.ok) {
      this.customers = await res.json();
      const badge = document.getElementById("badge-customers-count");
      if (badge) badge.textContent = this.customers.length;
      this.renderCustomersTable();
      this.populateCustomerDropdowns();
    }
  },

  async loadBookings() {
    try {
      const res = await fetch("/api/bookings");
      if (res.ok) {
        const raw = await res.json();
        this.bookings = (Array.isArray(raw) ? raw : []).map(b => {
          if (!b) return {};
          let ext = b.extension_history;
          if (typeof ext === "string") {
            try { ext = JSON.parse(ext); } catch (e) { ext = []; }
          }
          if (!Array.isArray(ext)) ext = [];
          return {
            ...b,
            booking_id: b.booking_id || "",
            car_id: b.car_id || "",
            customer: b.customer || "",
            status: b.status || "รอชำระมัดจำ",
            extension_history: ext,
            is_fully_paid: Boolean(b.is_fully_paid || b.rental_paid),
            contract_pdf_url: b.contract_pdf_url || ""
          };
        });
        const badge = document.getElementById("badge-frontoffice-bks");
        if (badge) badge.textContent = this.bookings.length;
        try { this.renderBookingsTable(); } catch (e) { console.error("renderBookingsTable error:", e); }
        try { this.populateBookingDropdowns(); } catch (e) { console.error("populateBookingDropdowns error:", e); }
      }
    } catch (err) {
      console.error("loadBookings fetch error:", err);
      this.bookings = this.bookings || [];
    }
  },

  async loadBackOfficeJobs() {
    const res = await fetch("/api/backoffice/jobs");
    if (res.ok) {
      this.backofficeJobs = await res.json();
      const badge = document.getElementById("badge-backoffice-jobs");
      if (badge) badge.textContent = this.backofficeJobs.length;
      this.populateBackofficeStaffFilter();
      this.renderBackofficeCalendar();
      this.renderBackOfficeJobs();
    }
  },

  async loadMonthlyReports() {
    const mPicker = document.getElementById("report-month-picker");
    const mVal = mPicker ? mPicker.value : "";
    const url = mVal ? `/api/reports/monthly?month=${mVal}` : `/api/reports/monthly`;
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      this.completedJobs = data.jobs || [];
      this.renderCompletedJobsTable();
      this.renderTrendChart();
    }
  },

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
});
