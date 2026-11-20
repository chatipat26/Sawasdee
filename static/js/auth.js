/**
 * Sawasdee Rental - Authentication Gate, Admin Users & Sidebar Search
 * Prototype Mixin for App
 */
Object.assign(App.prototype, {
  checkSessionTimeout() {
    if (!this.user) return false;
    const loginTime = parseInt(sessionStorage.getItem("sawasdee_login_time") || "0", 10);
    const SESSION_TIMEOUT_MS = 6 * 60 * 60 * 1000; // 6 hours
    if (loginTime && (Date.now() - loginTime > SESSION_TIMEOUT_MS)) {
      this.logout();
      const isEn = (this.currentLang === "EN");
      alert(isEn ? "Session expired (6 hours timeout). Please log in again." : "เซสชันการใช้งานหมดอายุ (ครบ 6 ชั่วโมง) กรุณาเข้าสู่ระบบใหม่อีกครั้งเพื่อความปลอดภัย");
      return true;
    }
    return false;
  },

  updateAuthUI() {
    const gateScreen = document.getElementById("auth-gate-screen");
    const mainWrapper = document.getElementById("main-app-wrapper");
    const sbName = document.getElementById("sb-user-name");
    const sbRole = document.getElementById("sb-user-role");
    const sbAdminBtn = document.getElementById("sb-admin-staff-btn");
    const headerName = document.getElementById("user-display-name");
    const headerRole = document.getElementById("user-role-tag");

    if (!this.user || !this.user.username) {
      if (gateScreen) gateScreen.style.display = "flex";
      if (mainWrapper) mainWrapper.style.display = "none";
      return;
    }

    if (gateScreen) gateScreen.style.display = "none";
    if (mainWrapper) mainWrapper.style.display = "flex";

    const un = this.user.name || this.user.username || "admin";
    const role = this.user.role || "Admin";
    const isAdmin = (role === "Admin" || (this.user.username && this.user.username.toLowerCase() === "admin"));
    const roleLabel = isAdmin ? "👑 ผู้ดูแลระบบ (Admin)" : "👷 พนักงานปฏิบัติงาน";

    if (sbName) sbName.textContent = this.user.username || un;
    if (sbRole) sbRole.textContent = roleLabel;
    if (headerName) headerName.textContent = un;
    if (headerRole) {
      headerRole.textContent = role;
      headerRole.style.background = isAdmin ? "#FEF3C7" : "#EFF6FF";
      headerRole.style.color = isAdmin ? "#92400E" : "#1E40AF";
    }

    if (sbAdminBtn) {
      sbAdminBtn.style.display = isAdmin ? "flex" : "none";
    }
  },

  renderUsersTable() {
    const tbody = document.getElementById("users-table-tbody");
    if (!tbody) return;

    tbody.innerHTML = this.users.map(u => {
      const isPending = u.status === "pending";
      const lineId = (u.line_user_id || "").trim();
      const shortLineId = lineId.length > 14 ? `${lineId.slice(0, 8)}...${lineId.slice(-4)}` : lineId;
      const lineBadge = lineId
        ? `<span class="badge badge-success" title="${lineId}">🟢 ผูกแล้ว (${shortLineId})</span>`
        : `<span class="badge badge-gray">⚪ ยังไม่ได้ผูก LINE ID</span>`;
      return `
        <tr>
          <td><b>${u.username}</b></td>
          <td>${u.name || '-'}</td>
          <td><span class="badge badge-info">${u.role || 'Staff'}</span></td>
          <td>
            <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
              ${lineBadge}
              <button onclick="app.editUserLineId('${u.username}', '${lineId}')" class="btn btn-sm btn-secondary" style="padding:2px 8px; font-size:11px;">🔗 ตั้งค่า LINE ID</button>
              ${lineId ? `<button onclick="app.testUserLinePush('${u.username}')" class="btn btn-sm btn-primary" style="padding:2px 8px; font-size:11px;" title="ทดสอบยิงข้อความตรงหาผู้ใช้นี้">📨 ทดสอบ</button>` : ''}
            </div>
          </td>
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
  },

  async editUserLineId(un, currentId = "") {
    const input = prompt(`กรอกรหัส LINE User ID ของ "${un}" (เช่น Uxxxxxxxx...)
(เว้นว่างเพื่อยกเลิกการผูก LINE ID):`, currentId || "");
    if (input === null) return;
    try {
      const res = await fetch(`/api/users/${encodeURIComponent(un)}/line-id`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ line_user_id: input.trim() })
      });
      const data = await res.json();
      if (data.success) {
        this.showToast(`✅ บันทึก LINE User ID สำหรับ ${un} เรียบร้อย`, "success");
        await this.loadUsers();
      } else {
        throw new Error(data.detail || "บันทึกไม่สำเร็จ");
      }
    } catch (e) {
      this.showToast("เกิดข้อผิดพลาด: " + e.message, "danger");
    }
  },

  async testUserLinePush(un) {
    try {
      this.showToast(`📲 กำลังส่งข้อความทดสอบหา ${un}...`, "info");
      const res = await fetch(`/api/users/${encodeURIComponent(un)}/test-line`, { method: "POST" });
      const data = await res.json();
      if (res.ok && data.success) {
        this.showToast(`✅ ส่งข้อความ LINE ตรงหา ${un} สำเร็จ! (ใช้เพียง 1 ข้อความ)`, "success");
      } else {
        throw new Error(data.detail || "ส่งข้อความไม่สำเร็จ กรุณาตรวจสอบ LINE User ID");
      }
    } catch (e) {
      this.showToast("ส่งไม่สำเร็จ: " + e.message, "danger");
    }
  },

  async approveUser(un) {
    await fetch(`/api/users/${un}/approve`, { method: "POST" });
    this.showToast(`อนุมัติผู้ใช้ ${un} เรียบร้อย`, "success");
    await this.loadUsers();
  },

  async rejectUser(un) {
    await fetch(`/api/users/${un}/reject`, { method: "POST" });
    this.showToast(`ระงับสิทธิ์ ${un} เรียบร้อย`, "info");
    await this.loadUsers();
  },

  async deleteUser(un) {
    if (!confirm(`ต้องการลบบัญชี ${un}?`)) return;
    await fetch(`/api/users/${un}`, { method: "DELETE" });
    this.showToast(`ลบบัญชี ${un} เรียบร้อย`, "success");
    await this.loadUsers();
  },

  setGateMode(mode) {
    const loginBox = document.getElementById("gate-mode-login");
    const regBox = document.getElementById("gate-mode-register");
    const forgotBox = document.getElementById("gate-mode-forgot");
    if (loginBox) loginBox.style.display = mode === "login" ? "block" : "none";
    if (regBox) regBox.style.display = mode === "register" ? "block" : "none";
    if (forgotBox) forgotBox.style.display = mode === "forgot" ? "block" : "none";

    ["login", "reg", "forgot"].forEach(m => {
      const el = document.getElementById(`gate-${m}-alert`);
      if (el) { el.style.display = "none"; el.textContent = ""; }
    });
  },

  showGateAlert(mode, type, msg) {
    const el = document.getElementById(`gate-${mode}-alert`);
    if (!el) return;
    el.className = `gate-alert ${type}`;
    el.textContent = msg;
    el.style.display = "block";
  },

  async submitGateLogin() {
    const unInput = document.getElementById("gate-login-username");
    const pwInput = document.getElementById("gate-login-password");
    const btn = document.getElementById("btn-gate-submit-login");
    const un = (unInput?.value || "").trim();
    const pw = (pwInput?.value || "").trim();

    if (!un || !pw) {
      this.showGateAlert("login", "error", "กรุณากรอกชื่อผู้ใช้งานและรหัสผ่าน");
      return;
    }

    if (btn) {
      btn.disabled = true;
      btn.textContent = "⏳ กำลังเข้าสู่ระบบ...";
    }

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: un, password: pw })
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง");
      }
      if (data.is_pending || data.success === false) {
        throw new Error(data.detail || "บัญชีของคุณกำลังรอการอนุมัติจากแอดมิน");
      }

      this.user = data.user || {};
      const authToken = data.token || this.user.token || "";
      if (authToken) {
        this.user.token = authToken;
        sessionStorage.setItem("sawasdee_token", authToken);
      }
      sessionStorage.setItem("sawasdee_user", JSON.stringify(this.user));
      sessionStorage.setItem("sawasdee_login_time", Date.now().toString());
      localStorage.removeItem("sawasdee_user");
      this.updateAuthUI();
      this.showToast(`เข้าสู่ระบบสำเร็จในฐานะ: ${this.user.name || this.user.username} ☁️`, "success");

      // Load all data after login
      await this.fetchInitialData();
      this.startLiveSyncPoller();
    } catch (err) {
      this.showGateAlert("login", "error", "❌ " + err.message);
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = "⚡ เข้าสู่ระบบ (Login)";
      }
    }
  },

  async submitGateRegister() {
    const un = (document.getElementById("gate-reg-username")?.value || "").trim();
    const fn = (document.getElementById("gate-reg-fullname")?.value || "").trim();
    const lineId = (document.getElementById("gate-reg-line-id")?.value || "").trim();
    const p1 = (document.getElementById("gate-reg-password")?.value || "").trim();
    const p2 = (document.getElementById("gate-reg-password2")?.value || "").trim();

    if (!un) {
      this.showGateAlert("reg", "error", "กรุณากรอกชื่อผู้ใช้งาน (Username)");
      return;
    }
    if (!fn) {
      this.showGateAlert("reg", "error", "กรุณากรอกชื่อ-นามสกุลจริง");
      return;
    }
    if (!lineId) {
      this.showGateAlert("reg", "error", "กรุณากรอกไอดีไลน์ (LINE ID / LINE User ID) เพื่อใช้รับแจ้งเตือนใบงาน");
      return;
    }
    if (p1 !== p2) {
      this.showGateAlert("reg", "error", "รหัสผ่านทั้งสองช่องไม่ตรงกัน");
      return;
    }
    if (p1.length < 6) {
      this.showGateAlert("reg", "error", "รหัสผ่านต้องมีความยาวอย่างน้อย 6 ตัวอักษร");
      return;
    }

    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: un, name: fn, line_user_id: lineId, password: p1 })
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || "ไม่สามารถลงทะเบียนได้");
      }
      this.showGateAlert("reg", "success", "✅ " + (data.message || "ลงทะเบียนสำเร็จ รอ Admin อนุมัติ"));
      setTimeout(() => {
        this.setGateMode("login");
        const uInp = document.getElementById("gate-login-username");
        if (uInp) uInp.value = un;
      }, 1500);
    } catch (err) {
      this.showGateAlert("reg", "error", "❌ " + err.message);
    }
  },

  async submitGateForgot() {
    const un = (document.getElementById("gate-forgot-username")?.value || "").trim();
    const oldP = (document.getElementById("gate-forgot-old-password")?.value || "").trim();
    const newP = (document.getElementById("gate-forgot-new-password")?.value || "").trim();

    if (!un || !newP) {
      this.showGateAlert("forgot", "error", "กรุณากรอกข้อมูลให้ครบถ้วน");
      return;
    }
    if (newP.length < 6) {
      this.showGateAlert("forgot", "error", "รหัสผ่านใหม่ต้องมีความยาวอย่างน้อย 6 ตัวอักษร");
      return;
    }

    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: un, old_password: oldP, new_password: newP })
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || "ไม่สามารถเปลี่ยนรหัสผ่านได้");
      }
      this.showGateAlert("forgot", "success", "✅ เปลี่ยนรหัสผ่านสำเร็จเรียบร้อย กรุณาเข้าสู่ระบบใหม่");
      setTimeout(() => {
        this.setGateMode("login");
      }, 1500);
    } catch (err) {
      this.showGateAlert("forgot", "error", "❌ " + err.message);
    }
  },

  handleSidebarSearch(kw) {
    this.sidebarSearchKw = (kw || "").trim().toLowerCase();
    this.renderFleetCards();
    if (this.activeModule === "backoffice") {
      this.renderBackOfficeJobs();
    }

    // Sidebar Search Popup: Customers & Bookings (TARGET MISSION 1 & 2)
    const resContainer = document.getElementById("sb-search-results");
    if (!resContainer) return;
    const cleanKw = this.sidebarSearchKw;
    if (!cleanKw) {
      resContainer.style.display = "none";
      resContainer.innerHTML = "";
      return;
    }

    // 1. Search Bookings (Active Pipeline & Completed Jobs)
    const bkMatches = [];
    const seenBks = new Set();

    (this.bookings || []).forEach(b => {
      const bid = String(b.booking_id || "").toLowerCase();
      const cust = String(b.customer || b.customer_name || "").toLowerCase();
      const car = String(b.car_id || b.car_plate || "").toLowerCase();
      if (bid.includes(cleanKw) || (cleanKw.startsWith("mrc") && bid.includes(cleanKw)) || (cleanKw.length >= 3 && (car.includes(cleanKw) || cust.includes(cleanKw)))) {
        if (!seenBks.has(b.booking_id)) {
          seenBks.add(b.booking_id);
          bkMatches.push({ ...b, isCompleted: (b.status === "เสร็จสิ้น" || b.status === "Completed") });
        }
      }
    });

    (this.completedJobs || []).forEach(j => {
      const bid = String(j.booking_id || "").toLowerCase();
      const cust = String(j.customer || "").toLowerCase();
      const car = String(j.car_id || "").toLowerCase();
      if (bid.includes(cleanKw) || (cleanKw.startsWith("mrc") && bid.includes(cleanKw)) || (cleanKw.length >= 3 && (car.includes(cleanKw) || cust.includes(cleanKw)))) {
        if (!seenBks.has(j.booking_id)) {
          seenBks.add(j.booking_id);
          bkMatches.push({ ...j, isCompleted: true, status: "เสร็จสิ้น" });
        }
      }
    });

    // 2. Search Customers
    const matches = (this.customers || []).filter(c => {
      const fn = String(c.full_name || "").toLowerCase();
      const ph = String(c.contact_no || c.phone_number || "").toLowerCase();
      const pass = String(c.passport_id || c.id_card_no || "").toLowerCase();
      const lic = String(c.licence_no || c.driver_license_no || "").toLowerCase();
      return fn.includes(cleanKw) || ph.includes(cleanKw) || pass.includes(cleanKw) || lic.includes(cleanKw);
    });

    if (bkMatches.length === 0 && matches.length === 0) {
      resContainer.style.display = "none";
      resContainer.innerHTML = "";
      return;
    }

    let html = "";

    // Render Booking Matches Section
    if (bkMatches.length > 0) {
      html += `
        <div style="padding:6px 10px; font-size:10.5px; font-weight:700; color:#E85826; background:#FFF7ED; border-bottom:1px solid #FED7AA; text-transform:uppercase; display:flex; justify-content:space-between; align-items:center;">
          <span>📋 รายการจองที่ค้นพบ (${bkMatches.length})</span>
          <span style="font-size:10px; color:#C2410C;">คลิกเพื่อไปที่งาน</span>
        </div>
      ` + bkMatches.slice(0, 8).map(b => {
        const isDone = b.isCompleted || b.status === "เสร็จสิ้น" || b.status === "Completed";
        const badgeColor = isDone ? "#059669" : (b.status === "กำลังเช่า" ? "#2563EB" : "#D97706");
        const badgeBg = isDone ? "#ECFDF5" : (b.status === "กำลังเช่า" ? "#EFF6FF" : "#FEF3C7");
        const stText = b.status || (isDone ? "เสร็จสิ้น" : "รอดำเนินการ");
        const safeBid = String(b.booking_id || "").replace(/'/g, "\\'");
        return `
          <div class="sb-booking-search-item"
            onclick="app.navigateToBooking('${safeBid}')"
            style="padding:8px 12px; cursor:pointer; border-bottom:1px solid #F1F5F9; display:flex; justify-content:space-between; align-items:center; background:#FFF; transition:background 0.15s;"
            onmouseover="this.style.background='#FFF7ED'"
            onmouseout="this.style.background='#FFF'">
            <div>
              <div style="font-weight:700; font-size:12px; color:#E85826; display:flex; align-items:center; gap:6px;">
                <span>🔖 ${b.booking_id}</span>
                <span style="font-size:10px; font-weight:700; background:${badgeBg}; color:${badgeColor}; padding:1px 6px; border-radius:10px;">${stText}</span>
              </div>
              <div style="font-size:11px; color:#475569; margin-top:2px;">
                🚗 ${b.car_id || '-'} | 👤 ${b.customer || b.customer_name || '-'}
              </div>
            </div>
            <button type="button" class="btn btn-sm btn-primary" style="padding:3px 9px; font-size:11px; font-weight:700; border-radius:6px; pointer-events:none;">
              ${isDone ? '📂 ดูประวัติ' : '👉 ไปที่งาน'}
            </button>
          </div>
        `;
      }).join("");
    }

    // Render Customer Matches Section
    if (matches.length > 0) {
      html += `
        <div style="padding:6px 10px; font-size:10.5px; font-weight:700; color:#8C827A; background:#FAF7F2; border-bottom:1px solid #E5DFD7; text-transform:uppercase; display:flex; justify-content:space-between; align-items:center;">
          <span>👥 ลูกค้าที่ค้นพบ (${matches.length})</span>
          <span style="font-size:10px; color:#64748B;">คลิกเพื่อดู/แก้ไข</span>
        </div>
      ` + matches.slice(0, 8).map(c => {
        const safeName = String(c.full_name || "").replace(/'/g, "\\'");
        return `
          <div class="sb-cust-search-item" 
            onclick="app.onSelectSidebarCustomer('${safeName}')" 
            style="padding:8px 12px; cursor:pointer; border-bottom:1px solid #F1F5F9; display:flex; justify-content:space-between; align-items:center; background:#FFF; transition:background 0.15s;"
            onmouseover="this.style.background='#FFF7ED'" 
            onmouseout="this.style.background='#FFF'">
            <div>
              <div style="font-weight:700; font-size:12px; color:#1E293B;">👤 ${c.full_name}</div>
              <div style="font-size:11px; color:#64748B;">📞 ${c.contact_no || c.phone_number || '-'} ${c.passport_id && c.passport_id !== '-' ? `| ID: ${c.passport_id}` : ''}</div>
            </div>
            <button type="button" class="btn btn-sm btn-secondary" style="padding:2px 8px; font-size:11px; background:#EFF6FF; border-color:#93C5FD; color:#1D4ED8; font-weight:700; pointer-events:none;">
              ✏️ ดู/แก้ไข
            </button>
          </div>
        `;
      }).join("");
    }

    resContainer.style.display = "block";
    resContainer.innerHTML = html;
  },

  onSidebarSearchEnter(kw) {
    const cleanKw = (kw || "").trim();
    if (!cleanKw) return;
    // Check if it matches a booking ID
    const activeBk = (this.bookings || []).find(b => String(b.booking_id).toLowerCase().includes(cleanKw.toLowerCase()));
    const compBk = (this.completedJobs || []).find(j => String(j.booking_id).toLowerCase().includes(cleanKw.toLowerCase()));
    if (activeBk || compBk || cleanKw.toUpperCase().startsWith("MRC")) {
      const targetId = activeBk ? activeBk.booking_id : (compBk ? compBk.booking_id : cleanKw);
      this.navigateToBooking(targetId);
      return;
    }
    // Check if it matches a customer
    const cust = (this.customers || []).find(c => String(c.full_name || "").toLowerCase().includes(cleanKw.toLowerCase()));
    if (cust) {
      this.onSelectSidebarCustomer(cust.full_name);
      return;
    }
  },

  async navigateToBooking(bookingId) {
    const resContainer = document.getElementById("sb-search-results");
    if (resContainer) resContainer.style.display = "none";

    const cleanId = String(bookingId || "").trim();
    if (!cleanId) return;

    // 1. Check active bookings
    let activeBk = (this.bookings || []).find(b => String(b.booking_id).toUpperCase() === cleanId.toUpperCase());
    
    // 2. Check completed jobs
    let completedBk = (this.completedJobs || []).find(j => String(j.booking_id).toUpperCase() === cleanId.toUpperCase());

    // 3. If neither found locally, try fetching from API
    if (!activeBk && !completedBk) {
      try {
        const res = await fetch(`/api/bookings/${encodeURIComponent(cleanId)}`);
        if (res.ok) {
          activeBk = await res.json();
          if (activeBk && !this.bookings.some(b => b.booking_id === activeBk.booking_id)) {
            this.bookings.unshift(activeBk);
          }
        }
      } catch (e) {
        console.warn("Could not fetch booking from API:", e);
      }
    }

    if (activeBk && activeBk.status !== "เสร็จสิ้น" && activeBk.status !== "Completed") {
      // Active booking: Route to Front Office Tab 5 (Pipeline) & Auto-filter
      this.switchModule("frontoffice");
      await this.switchTab("dashboard_bks");
      
      const searchInp = document.getElementById("bks-search-input");
      if (searchInp) searchInp.value = cleanId;
      
      const monthSel = document.getElementById("bks-month-filter");
      if (monthSel) monthSel.value = "all";
      
      const statusSel = document.getElementById("bks-status-filter");
      if (statusSel) statusSel.value = "all_with_completed";

      this.renderBookingsTable();

      // Scroll and highlight
      setTimeout(() => {
        const rows = document.querySelectorAll("#bookings-table-body tr");
        for (const row of rows) {
          if (row.textContent.includes(cleanId)) {
            row.scrollIntoView({ behavior: "smooth", block: "center" });
            row.style.transition = "background-color 0.5s";
            row.style.backgroundColor = "#FEF3C7";
            setTimeout(() => {
              row.style.backgroundColor = "";
            }, 3500);
            break;
          }
        }
      }, 250);

      const isEn = (this.currentLang === "EN");
      this.showToast(isEn ? `Found Active Booking ${cleanId}` : `พบการจอง ${cleanId} ในระบบ Pipeline`, "success");
    } else if (completedBk || (activeBk && (activeBk.status === "เสร็จสิ้น" || activeBk.status === "Completed"))) {
      // Completed booking: Route to Completed Jobs Archive in Dashboard module
      this.switchModule("dashboard");
      
      const expBody = document.getElementById("body-expander-completed");
      if (!expBody || expBody.style.display === "none") {
        this.toggleExpander("expander-completed");
      }

      this.sidebarSearchKw = cleanId;
      const sbInput = document.getElementById("sb-search-input");
      if (sbInput) sbInput.value = cleanId;

      this.renderCompletedJobsTable();

      setTimeout(() => {
        const expCard = document.getElementById("expander-completed");
        if (expCard) expCard.scrollIntoView({ behavior: "smooth", block: "start" });

        const rows = document.querySelectorAll("#completed-jobs-tbody tr");
        for (const row of rows) {
          if (row.textContent.includes(cleanId)) {
            row.scrollIntoView({ behavior: "smooth", block: "center" });
            row.style.transition = "background-color 0.5s";
            row.style.backgroundColor = "#FEF3C7";
            setTimeout(() => {
              row.style.backgroundColor = "";
            }, 3500);
            break;
          }
        }
      }, 250);

      const isEn = (this.currentLang === "EN");
      this.showToast(isEn ? `Found Completed Job ${cleanId}` : `พบประวัติงานเสร็จสิ้น ${cleanId}`, "success");
    } else {
      const isEn = (this.currentLang === "EN");
      this.showToast(isEn ? `Booking ${cleanId} not found` : `ไม่พบรหัสการจอง ${cleanId}`, "warning");
    }
  },

  onSelectSidebarCustomer(custName) {
    const resContainer = document.getElementById("sb-search-results");
    if (resContainer) {
      resContainer.style.display = "none";
    }
    this.openEditCustomerModal(custName);
  },

  logout() {
    this.user = null;
    sessionStorage.removeItem("sawasdee_token");
    sessionStorage.removeItem("sawasdee_user");
    sessionStorage.removeItem("sawasdee_login_time");
    localStorage.removeItem("sawasdee_user");
    this.updateAuthUI();
    const isEn = (this.currentLang === "EN");
    this.showToast(isEn ? "Signed out successfully" : "ออกจากระบบเรียบร้อย", "info");
  }
});
