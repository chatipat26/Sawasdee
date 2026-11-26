/**
 * Sawasdee Rental - Back Office Jobs, FullCalendar, Damage Canvas & Vehicle Inspections
 * Prototype Mixin for App
 */
Object.assign(App.prototype, {
  populateBackofficeStaffFilter() {
    const sel = document.getElementById("bo-staff-filter");
    if (!sel) return;
    const currentVal = sel.value || this.boStaffFilter || "";
    const isEn = (this.currentLang === "EN");
    const staffSet = new Set();
    (this.backofficeJobs || []).forEach(j => {
      const w = String(j.worker || "").trim();
      if (w && w !== "-" && w !== "ยังไม่มอบหมาย") {
        staffSet.add(w);
      }
    });
    let html = `<option value="">${isEn ? 'All Staff (ทุกคน)' : 'ทุกคน (All Staff)'}</option>`;
    Array.from(staffSet).sort().forEach(st => {
      html += `<option value="${st}">${st}</option>`;
    });
    sel.innerHTML = html;
    if (currentVal) sel.value = currentVal;
  },

  onBackofficeStaffFilterChange(staff) {
    this.boStaffFilter = staff || "";
    this.renderBackofficeCalendar();
    this.renderBackOfficeJobs();
  },

  onBackofficeSearch(val) {
    this.boSearchKw = (val || "").trim();
    this.renderBackOfficeJobs();
    if (this.boViewMode === "calendar") {
      this.renderBackofficeCalendar();
    }
  },

  setBackofficeViewMode(mode) {
    this.boViewMode = mode;
    const calWrap = document.getElementById("bo-calendar-wrapper");
    const tblWrap = document.getElementById("bo-full-table-card");
    const btnCal = document.getElementById("btn-bo-view-calendar");
    const btnTbl = document.getElementById("btn-bo-view-table");

    if (mode === "calendar") {
      if (calWrap) calWrap.style.display = "block";
      if (tblWrap) tblWrap.style.display = "none";
      if (btnCal) {
        btnCal.className = "btn btn-sm btn-primary";
        btnCal.style.cssText = "font-size:12px; padding:4px 12px; font-weight:700;";
      }
      if (btnTbl) {
        btnTbl.className = "btn btn-sm btn-secondary";
        btnTbl.style.cssText = "font-size:12px; padding:4px 12px;";
      }
      setTimeout(() => {
        if (this.boCalendar) {
          this.boCalendar.updateSize();
        } else {
          this.renderBackofficeCalendar();
        }
      }, 80);
    } else {
      if (calWrap) calWrap.style.display = "none";
      if (tblWrap) tblWrap.style.display = "block";
      if (btnCal) {
        btnCal.className = "btn btn-sm btn-secondary";
        btnCal.style.cssText = "font-size:12px; padding:4px 12px;";
      }
      if (btnTbl) {
        btnTbl.className = "btn btn-sm btn-primary";
        btnTbl.style.cssText = "font-size:12px; padding:4px 12px; font-weight:700;";
      }
      this.renderBackOfficeJobs();
    }
  },

  renderBackofficeCalendar() {
    const calendarEl = document.getElementById("backoffice-calendar");
    if (!calendarEl) return;
    if (typeof FullCalendar === "undefined") {
      console.warn("FullCalendar is not loaded yet");
      return;
    }

    const isEn = (this.currentLang === "EN");
    const staffFilter = (document.getElementById("bo-staff-filter")?.value || this.boStaffFilter || "").trim();

    const jobs = (this.backofficeJobs || []).filter(j => {
      if (staffFilter && String(j.worker || "").trim() !== staffFilter) {
        return false;
      }
      return true;
    });

    const events = jobs.map(j => {
      const isDisp = j.job_type === "Dispatch";
      const isMnt = j.is_maintenance || j.job_type === "Maintenance" || j.job_type === "Renewal";
      
      let title = "";
      let color = "#2563EB";
      let startStr = j.date_iso;

      if (isMnt) {
        title = `[🛠️ ${isEn ? 'Maint' : 'ซ่อม'}] ${j.car_id || ''} (${j.booking_id})`;
        color = "#EA580C"; // Orange for maintenance/renewal
        startStr = j.start_date || j.date_iso;
      } else if (isDisp) {
        const offTag = j.is_offsite ? (isEn ? '🚚 Off-site' : '🚚 ส่งนอกสถานที่') : `🚚 ${isEn ? 'Dispatch' : 'ส่ง'}`;
        const feeTag = (j.fee && parseFloat(j.fee) > 0) ? ` (+฿${parseFloat(j.fee).toLocaleString()})` : '';
        title = `[${offTag}${feeTag}] ${j.car_id || ''} - ${j.customer || ''} (${j.booking_id})`;
        color = j.is_offsite ? "#D97706" : "#2563EB";
        if (j.start_date && j.start_time) {
          startStr = `${j.start_date}T${j.start_time}`;
        } else if (j.start_date) {
          startStr = j.start_date;
        }
      } else {
        const offTag = j.is_offsite ? (isEn ? '🚚 Off-site Return' : '🚚 รับคืนนอกสถานที่') : `🔙 ${isEn ? 'Return' : 'รับคืน'}`;
        const feeTag = (j.fee && parseFloat(j.fee) > 0) ? ` (+฿${parseFloat(j.fee).toLocaleString()})` : '';
        title = `[${offTag}${feeTag}] ${j.car_id || ''} - ${j.customer || ''} (${j.booking_id})`;
        color = j.is_offsite ? "#0D9488" : "#16A34A";
        if (j.end_date && j.end_time) {
          startStr = `${j.end_date}T${j.end_time}`;
        } else if (j.end_date) {
          startStr = j.end_date;
        }
      }

      return {
        id: `${j.job_type}_${j.booking_id}`,
        title: title,
        start: startStr,
        backgroundColor: color,
        borderColor: color,
        textColor: "#FFFFFF",
        extendedProps: j
      };
    });

    if (this.boCalendar) {
      this.boCalendar.removeAllEvents();
      this.boCalendar.addEventSource(events);
      this.boCalendar.setOption('locale', isEn ? 'en' : 'th');
      this.boCalendar.updateSize();
      return;
    }

    this.boCalendar = new FullCalendar.Calendar(calendarEl, {
      initialView: 'dayGridMonth',
      navLinks: true,
      headerToolbar: {
        left: 'prev,next today',
        center: 'title',
        right: 'dayGridMonth,timeGridWeek,listMonth'
      },
      locale: isEn ? 'en' : 'th',
      buttonText: isEn ? {
        today: 'Today',
        month: 'Month',
        week: 'Week',
        list: 'List'
      } : {
        today: 'วันนี้',
        month: 'ปฏิทิน',
        week: 'สัปดาห์',
        list: 'รายการ'
      },
      events: events,
      eventTimeFormat: {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      },
      displayEventTime: true,
      dayMaxEvents: 3,
      navLinkDayClick: (date, jsEvent) => {
        if (jsEvent && jsEvent.preventDefault) jsEvent.preventDefault();
        const dStr = typeof date === "string" ? date : (date.toISOString ? date.toISOString().split("T")[0] : String(date));
        if (this.boCalendar) {
          try {
            this.boCalendar.changeView('timeGridWeek', date);
          } catch(e) {
            try {
              this.boCalendar.changeView('listWeek', date);
            } catch(e2) {
              this.boCalendar.gotoDate(date);
            }
          }
        }
        this.onCalendarDateClick(dStr);
      },
      dateClick: (info) => {
        const dStr = info.dateStr || (info.date && info.date.toISOString ? info.date.toISOString().split("T")[0] : "");
        const targetDate = info.date || dStr;
        if (this.boCalendar && this.boCalendar.view && this.boCalendar.view.type === 'dayGridMonth') {
          try {
            this.boCalendar.changeView('timeGridWeek', targetDate);
          } catch(e) {
            try {
              this.boCalendar.changeView('listWeek', targetDate);
            } catch(e2) {
              this.boCalendar.gotoDate(targetDate);
            }
          }
        }
        this.onCalendarDateClick(dStr);
      },
      eventClick: (info) => {
        this.onCalendarEventClick(info.event);
      }
    });

    this.boCalendar.render();
  },

  onCalendarDateClick(dateStr) {
    const dayCard = document.getElementById("bo-day-jobs-card");
    const dayTbody = document.getElementById("bo-day-jobs-tbody");
    const dayTitle = document.getElementById("bo-day-jobs-title");
    if (!dayCard || !dayTbody) return;

    const isEn = (this.currentLang === "EN");
    const matched = (this.backofficeJobs || []).filter(j => {
      const d1 = j.date_iso;
      const d2 = j.start_date;
      const d3 = j.end_date;
      return d1 === dateStr || d2 === dateStr || d3 === dateStr;
    });

    if (dayTitle) {
      dayTitle.textContent = isEn
        ? `📋 Work Orders for ${dateStr} (${matched.length} jobs)`
        : `📋 ตารางงานประจำวันที่ ${dateStr} (${matched.length} รายการ)`;
    }

    if (matched.length === 0) {
      dayTbody.innerHTML = `<tr><td colspan="9" style="text-align:center; padding:24px; color:#64748B;">${isEn ? 'No work orders scheduled on this date' : 'ไม่มีงานที่นัดหมายในวันนี้'}</td></tr>`;
    } else {
      dayTbody.innerHTML = matched.map(j => this.renderSingleBackofficeJobRow(j, isEn)).join("");
    }

    dayCard.style.display = "block";
    dayCard.scrollIntoView({ behavior: "smooth", block: "nearest" });
  },

  onCalendarEventClick(calEvent) {
    const j = calEvent.extendedProps;
    if (!j) return;
    const isEn = (this.currentLang === "EN");

    const dayCard = document.getElementById("bo-day-jobs-card");
    const dayTbody = document.getElementById("bo-day-jobs-tbody");
    const dayTitle = document.getElementById("bo-day-jobs-title");
    if (dayCard && dayTbody) {
      if (dayTitle) {
        dayTitle.textContent = isEn
          ? `📋 Work Order: ${j.booking_id} (${j.job_type})`
          : `📋 รายละเอียดใบงาน: ${j.booking_id} (${j.job_type})`;
      }
      dayTbody.innerHTML = this.renderSingleBackofficeJobRow(j, isEn);
      dayCard.style.display = "block";
      dayCard.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }

    if (j.is_maintenance || j.job_type === "Maintenance" || j.job_type === "Renewal") {
      this.openCloseMaintenanceModal(j.booking_id);
    } else {
      this.openHandoverModal(j.booking_id, j.job_type);
    }
  },

  renderSingleBackofficeJobRow(j, isEn) {
    const isDisp = j.job_type === "Dispatch";
    const isMnt = j.is_maintenance || j.job_type === "Maintenance" || j.job_type === "Renewal";
    let typeBadge = '';
    if (j.job_type === "Maintenance") {
      typeBadge = `<span class="badge" style="background:#FFF7ED; color:#C2410C; border:1px solid #FDBA74; font-weight:700;">${isEn ? 'Maintenance' : 'ซ่อมบำรุง'}</span>`;
    } else if (j.job_type === "Renewal") {
      typeBadge = `<span class="badge" style="background:#F0FDF4; color:#15803D; border:1px solid #BBF7D0; font-weight:700;">${isEn ? 'Renewal' : 'ต่อทะเบียน/พรบ./ประกัน'}</span>`;
    } else if (isDisp) {
      typeBadge = `<span class="badge badge-info">${isEn ? 'Dispatch' : 'ส่งมอบรถ (Dispatch)'}</span>`;
      if (j.is_offsite) {
        const feeVal = parseFloat(j.fee || j.delivery_fee || 0);
        typeBadge += `<div style="margin-top:3px;"><span class="badge" style="background:#FFF7ED; color:#C2410C; border:1px solid #FDBA74; font-size:10.5px; font-weight:700;">🚚 ${isEn ? 'Off-site' : 'ส่งนอกสถานที่'}${feeVal > 0 ? ` ฿${feeVal.toLocaleString()}` : ''}</span></div>`;
      }
    } else {
      typeBadge = `<span class="badge badge-warning">${isEn ? 'Return' : 'รับรถคืน (Return)'}</span>`;
      if (j.is_offsite) {
        const feeVal = parseFloat(j.fee || j.pickup_fee || 0);
        typeBadge += `<div style="margin-top:3px;"><span class="badge" style="background:#F0FDFA; color:#0F766E; border:1px solid #99F6E4; font-size:10.5px; font-weight:700;">🚚 ${isEn ? 'Off-site Return' : 'รับคืนนอกสถานที่'}${feeVal > 0 ? ` ฿${feeVal.toLocaleString()}` : ''}</span></div>`;
      }
    }

    let actionButtons = '';
    if (isMnt) {
      const isRenewalJob = j.job_type === "Renewal" || (j.order_type && (String(j.order_type).includes("ต่อทะเบียน") || String(j.order_type).includes("ประกัน") || String(j.order_type).includes("พ.ร.บ.") || String(j.order_type).includes("ภาษี") || String(j.order_type).includes("แพ็กคู่")));
      const btnLabel = isRenewalJob ? (isEn ? "Submit / Update" : "ส่งงาน / อัปเดตวัน") : (isEn ? "Inspect & Close" : "ตรวจรับ & ปิดงาน");
      actionButtons = `
        <a href="/api/pdf/maintenance/${j.booking_id}" target="_blank" class="btn btn-sm btn-secondary" title="${isEn ? 'Print Job PDF' : 'พิมพ์ใบงาน PDF'}">${isEn ? 'Job PDF' : 'ใบงาน PDF'}</a>
        <button onclick="app.openCloseMaintenanceModal('${j.booking_id}')" class="btn btn-sm btn-success" style="font-weight:700;" title="${btnLabel}">
          ${btnLabel}
        </button>
      `;
    } else {
      const lockTitle = isEn ? 'Wait for Dispatch completion' : 'ต้องปิดงานส่งมอบก่อน';
      const inspectBtnLabel = isEn ? 'Inspect & Complete' : 'ตรวจรับส่ง & ปิดงาน';
      actionButtons = `
        <a href="/api/pdf/job/${j.booking_id}" target="_blank" class="btn btn-sm btn-secondary" title="${isEn ? 'Inspection PDF' : 'ใบตรวจสภาพ PDF'}">PDF</a>
        <button onclick="app.openHandoverModal('${j.booking_id}', '${j.job_type}')" class="btn btn-sm btn-primary" ${j.is_locked ? `disabled title="${lockTitle}"` : ''}>
          ${inspectBtnLabel}
        </button>
      `;
    }

    let statusBadge = '';
    if (j.status === "กำลังซ่อมบำรุง") {
      statusBadge = `<span class="badge" style="background:#FFF7ED; color:#C2410C; border:1px solid #FDBA74;">${isEn ? '🛠️ In Maintenance' : '🛠️ กำลังซ่อมบำรุง'}</span>`;
    } else if (j.status === "กำลังต่อภาษี/ประกัน") {
      statusBadge = `<span class="badge" style="background:#FEF3C7; color:#D97706; border:1px solid #FCD34D;">${isEn ? '⏳ Renewing Tax/Ins.' : '⏳ กำลังต่อภาษี/ประกัน'}</span>`;
    } else {
      let displayStatus = j.status;
      if (isEn) {
        if (displayStatus === "รอส่งมอบ") displayStatus = "Ready for Dispatch";
        else if (displayStatus === "กำลังเช่า") displayStatus = "Active Rental";
        else if (displayStatus === "รอรับคืน") displayStatus = "Ready for Return";
        else if (displayStatus === "🔒 รอส่งรถก่อน") displayStatus = "🔒 Wait for Dispatch";
        else if (displayStatus === "รอชำระมัดจำ") displayStatus = "Pending Deposit";
      }
      statusBadge = `<span class="badge badge-gray">${displayStatus}</span>`;
    }

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
        <td style="max-width:160px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${j.location}">
          ${j.is_offsite ? `<span style="color:#D97706; font-weight:700;">🚚</span> ` : ''}${j.location.startsWith("http") ? `<a href="${j.location}" target="_blank" style="color:#2563EB;">📍 แผนที่นัดหมาย</a>` : j.location}
          ${j.map_url ? `<br><a href="${j.map_url}" target="_blank" style="color:#2563EB; font-size:11px;">🗺️ แผนที่</a>` : ''}
        </td>
        <td>${statusBadge}</td>
        <td style="text-align:center; white-space:nowrap;">
          ${actionButtons}
        </td>
      </tr>
    `;
  },

  renderBackOfficeJobs() {
    const tbody = document.getElementById("backoffice-jobs-tbody");
    if (!tbody) return;

    const boKw = (document.getElementById("bo-search-input")?.value || "").toLowerCase().trim();
    const sbKw = (this.sidebarSearchKw || "").toLowerCase().trim();
    const kw = boKw || sbKw;
    const staffFilter = (document.getElementById("bo-staff-filter")?.value || this.boStaffFilter || "").trim();

    const filtered = (this.backofficeJobs || []).filter(j => {
      if (staffFilter && String(j.worker || "").trim() !== staffFilter) {
        return false;
      }
      if (kw) {
        const s = `${j.booking_id} ${j.car_id} ${j.customer} ${j.job_type} ${j.worker || ''} ${j.location || ''}`.toLowerCase();
        if (!s.includes(kw)) return false;
      }
      return true;
    });

    const isEn = (this.currentLang === "EN");
    if (filtered.length === 0) {
      const emptyMsg = isEn ? "No work orders in the system currently" : "ไม่มีใบงานในระบบขณะนี้";
      tbody.innerHTML = `<tr><td colspan="9" style="text-align:center; padding:30px; color:#64748B;">${emptyMsg}</td></tr>`;
      return;
    }

    tbody.innerHTML = filtered.map(j => this.renderSingleBackofficeJobRow(j, isEn)).join("");
  },

  initDamageCanvas() {
    const canvas = document.getElementById("insp-car-diagram-canvas");
    if (!canvas) return;
    this.damageMarks = this.damageMarks || [];
    this.currentDamageTool = this.currentDamageTool || "dent";
    this.redrawDamageCanvas();
    this.setDamageTool(this.currentDamageTool);

    if (!canvas._hasDamageHandler) {
      canvas._hasDamageHandler = true;
      const getPos = (e) => {
        const rect = canvas.getBoundingClientRect();
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        return {
          x: (clientX - rect.left) * scaleX,
          y: (clientY - rect.top) * scaleY
        };
      };
      const addMark = (e) => {
        e.preventDefault();
        const pos = getPos(e);
        this.damageMarks.push({
          x: pos.x,
          y: pos.y,
          type: this.currentDamageTool
        });
        this.redrawDamageCanvas();
      };
      canvas.addEventListener("click", addMark);
    }
  },

  setDamageTool(tool) {
    this.currentDamageTool = tool;
    const btnDent = document.getElementById("btn-tool-dent");
    const btnScratch = document.getElementById("btn-tool-scratch");
    if (btnDent && btnScratch) {
      if (tool === "dent") {
        btnDent.style.boxShadow = "0 0 0 2px #DC2626";
        btnDent.style.borderColor = "#DC2626";
        btnScratch.style.boxShadow = "none";
        btnScratch.style.borderColor = "#93C5FD";
      } else {
        btnScratch.style.boxShadow = "0 0 0 2px #2563EB";
        btnScratch.style.borderColor = "#2563EB";
        btnDent.style.boxShadow = "none";
        btnDent.style.borderColor = "#FCA5A5";
      }
    }
  },

  clearDamageCanvas() {
    this.damageMarks = [];
    this.redrawDamageCanvas();
  },

  redrawDamageCanvas() {
    const canvas = document.getElementById("insp-car-diagram-canvas");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = "#FAFAFA";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = "#CBD5E1";
    ctx.lineWidth = 1;
    ctx.strokeRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = "#475569";
    ctx.font = "bold 10px Sarabun, sans-serif";
    ctx.textAlign = "center";

    // 1. FRONT
    ctx.fillText("FRONT", 65, 20);
    ctx.strokeStyle = "#64748B";
    ctx.lineWidth = 1.2;
    ctx.strokeRect(30, 26, 70, 50);
    ctx.strokeRect(36, 30, 16, 12);
    ctx.strokeRect(78, 30, 16, 12);
    ctx.strokeRect(45, 60, 40, 10);

    // 2. REAR
    ctx.fillText("REAR", 65, 115);
    ctx.strokeRect(30, 122, 70, 50);
    ctx.strokeRect(36, 126, 16, 12);
    ctx.strokeRect(78, 126, 16, 12);
    ctx.strokeRect(48, 142, 34, 14);

    // 3. TOP VIEW
    ctx.fillText("TOP VIEW", 240, 18);
    ctx.strokeRect(205, 24, 70, 160);
    ctx.strokeRect(213, 50, 54, 25);
    ctx.strokeRect(213, 85, 54, 45);
    ctx.strokeRect(213, 138, 54, 25);

    // 4. LEFT
    ctx.fillText("LEFT SIDE", 400, 20);
    ctx.strokeRect(335, 28, 130, 48);
    ctx.beginPath(); ctx.arc(360, 78, 9, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(440, 78, 9, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeRect(365, 34, 32, 20);
    ctx.strokeRect(402, 34, 32, 20);

    // 5. RIGHT
    ctx.fillText("RIGHT SIDE", 400, 115);
    ctx.strokeRect(335, 122, 130, 48);
    ctx.beginPath(); ctx.arc(360, 172, 9, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(440, 172, 9, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeRect(365, 128, 32, 20);
    ctx.strokeRect(402, 128, 32, 20);

    (this.damageMarks || []).forEach(m => {
      ctx.beginPath();
      if (m.type === "dent") {
        ctx.fillStyle = "#DC2626";
        ctx.font = "bold 15px Arial, sans-serif";
        ctx.fillText("X", m.x, m.y + 5);
        ctx.strokeStyle = "rgba(220, 38, 38, 0.4)";
        ctx.arc(m.x, m.y, 9, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        ctx.fillStyle = "#2563EB";
        ctx.font = "bold 15px Arial, sans-serif";
        ctx.fillText("D", m.x, m.y + 5);
        ctx.strokeStyle = "rgba(37, 99, 235, 0.4)";
        ctx.arc(m.x, m.y, 9, 0, Math.PI * 2);
        ctx.stroke();
      }
    });
  },

  getCarDiagramBase64() {
    const canvas = document.getElementById("insp-car-diagram-canvas");
    if (!canvas) return null;
    return canvas.toDataURL("image/png");
  },

  openHandoverModal(bkId, jobType) {
    const b = (this.bookings || []).find(x => x.booking_id === bkId);
    if (jobType === "Dispatch") {
      if (b && !b.deposit_paid) {
        alert("⚠️ ยังไม่ได้ชำระเงินมัดจำ ไม่สามารถส่งมอบรถได้ (กรุณาไปที่แท็บ \"2. เงินมัดจำ & การเงิน\")");
        return;
      }
      if (b && !b.rental_paid) {
        alert("⚠️ ยังไม่ได้ชำระค่าเช่าคงเหลือ กรุณาชำระค่าเช่าให้เรียบร้อยก่อนส่งมอบรถ");
        this.openSettleModal(bkId);
        return;
      }
      if (b && !b.contract_issued) {
        alert("⚠️ สถานะรถจะเปลี่ยนเป็น \"กำลังเช่า\" ได้ก็ต่อเมื่อ \"ออกสัญญาเช่าแล้ว\" เท่านั้น ห้ามเปลี่ยนเป็นกำลังเช่าก่อนออกสัญญาเด็ดขาด กรุณาไปที่แท็บ \"4. จัดทำสัญญาเช่า\" เพื่อตรวจสอบและออกสัญญาเช่าให้เรียบร้อยก่อน");
        return;
      }
    }

    document.getElementById("insp-bk-id").value = bkId;
    document.getElementById("insp-job-type").value = jobType;
    document.getElementById("modal-handover-title").textContent = jobType === "Dispatch"
      ? `🚚 ตรวจสภาพและส่งมอบรถ (Dispatch - ${bkId})`
      : `🔙 ตรวจสภาพและรับรถคืน (Return - ${bkId})`;

    const condSec = document.getElementById("insp-return-condition-section");
    if (condSec) {
      condSec.style.display = jobType === "Return" ? "block" : "none";
      const radNorm = document.getElementById("insp-cond-normal");
      if (radNorm) radNorm.checked = true;

      // Check if early return (returning before contract end date)
      const badgeEarly = document.getElementById("insp-early-return-badge");
      if (badgeEarly && b) {
        const endStr = b.end_date ? (typeof b.end_date === "string" ? b.end_date.split("T")[0] : "") : "";
        const todayStr = new Date().toISOString().split("T")[0];
        if (endStr && todayStr < endStr) {
          badgeEarly.style.display = "inline-block";
          const dmy = this.ymdToDmy ? this.ymdToDmy(endStr) : endStr;
          badgeEarly.textContent = `⚡ คืนรถก่อนกำหนดสัญญา (ครบกำหนดจริง: ${dmy})`;
        } else {
          badgeEarly.style.display = "none";
        }
      }

      // Reset Branch B sub-options
      const radEnd = document.getElementById("insp-sub-end-contract");
      if (radEnd) radEnd.checked = true;
      const swapInput = document.getElementById("insp-swap-car-search");
      if (swapInput) swapInput.value = "";
      const swapPlate = document.getElementById("insp-swap-selected-plate");
      if (swapPlate) swapPlate.value = "";
      const swapBadge = document.getElementById("insp-swap-selected-badge");
      if (swapBadge) {
        swapBadge.style.display = "none";
        swapBadge.innerHTML = "";
      }

      // Q2: Reset Security Deposit Refund Confirmation checkbox & fields
      const chkRefund = document.getElementById("insp-confirm-refund-deposit");
      if (chkRefund) chkRefund.checked = true;
      const refRefEl = document.getElementById("insp-refund-ref");
      if (refRefEl) refRefEl.value = "";

      this.onInspConditionChange("normal");
    }

    this.uploadedPhotos = [];
    const photoContainer = document.getElementById("insp-uploaded-photos");
    if (photoContainer) photoContainer.innerHTML = "";
    this.damageMarks = [];
    setTimeout(() => this.initDamageCanvas(), 60);

    const checkinImgSec = document.getElementById("insp-checkin-images-section");
    if (checkinImgSec) {
      checkinImgSec.style.display = jobType === "Return" ? "block" : "none";
    }
    if (jobType === "Return") {
      const fVal = b?.checkin_img_front || document.getElementById("assign-ret-img-front")?.value || "";
      const lVal = b?.checkin_img_left || document.getElementById("assign-ret-img-left")?.value || "";
      const reVal = b?.checkin_img_rear || document.getElementById("assign-ret-img-rear")?.value || "";
      const riVal = b?.checkin_img_right || document.getElementById("assign-ret-img-right")?.value || "";

      const elF = document.getElementById("insp-checkin-img-front");
      const elL = document.getElementById("insp-checkin-img-left");
      const elRe = document.getElementById("insp-checkin-img-rear");
      const elRi = document.getElementById("insp-checkin-img-right");

      if (elF) elF.value = fVal;
      if (elL) elL.value = lVal;
      if (elRe) elRe.value = reVal;
      if (elRi) elRi.value = riVal;

      this.updateCheckinImgPreview("front", fVal);
      this.updateCheckinImgPreview("left", lVal);
      this.updateCheckinImgPreview("rear", reVal);
      this.updateCheckinImgPreview("right", riVal);
    }

    const pdfContainer = document.getElementById("insp-pdf-result-container");
    const modalPrintBtn = document.getElementById("btn-modal-print-inspection");
    if (pdfContainer && modalPrintBtn) {
      const existingPdf = (jobType === "Dispatch" ? b?.checkout_pdf_url : b?.checkin_pdf_url);
      if (existingPdf) {
        modalPrintBtn.href = existingPdf;
        pdfContainer.style.display = "flex";
      } else {
        pdfContainer.style.display = "none";
      }
    }
    this.openModal("modal-handover");
  },

  onInspConditionChange(cond) {
    const normInfo = document.getElementById("insp-cond-normal-info");
    const repInfo = document.getElementById("insp-cond-repair-info");
    const submitBtn = document.getElementById("btn-submit-inspection");

    if (cond === "needs_repair") {
      if (normInfo) normInfo.style.display = "none";
      if (repInfo) repInfo.style.display = "block";
      const isSwap = document.getElementById("insp-sub-swap-car")?.checked;
      this.onInspBranchBActionChange(isSwap ? "swap_car" : "end_contract");
    } else {
      if (normInfo) normInfo.style.display = "block";
      if (repInfo) repInfo.style.display = "none";
      if (submitBtn) submitBtn.innerHTML = `✅ ยืนยันบันทึกผล & ปิดงาน`;
      this.recalcInspRefundPreview();
    }
  },

  onInspBranchBActionChange(action) {
    const swapPanel = document.getElementById("insp-swap-car-panel");
    const depositPreview = document.getElementById("insp-deposit-calc-preview");
    const swapWarning = document.getElementById("insp-swap-damage-warning");
    const submitBtn = document.getElementById("btn-submit-inspection");

    if (action === "swap_car") {
      if (swapPanel) swapPanel.style.display = "block";
      if (depositPreview) depositPreview.style.display = "none";
      if (swapWarning) swapWarning.style.display = "block";
      if (submitBtn) submitBtn.innerHTML = `🔄 ยืนยันสลับรถทดแทน & ส่งรถเก่าเข้าซ่อม`;
      this.populateInspSwapCars();
    } else {
      if (swapPanel) swapPanel.style.display = "none";
      if (depositPreview) depositPreview.style.display = "block";
      if (swapWarning) swapWarning.style.display = "none";
      if (submitBtn) submitBtn.innerHTML = `✅ ยืนยันบันทึกผล & ปิดงาน`;
      this.recalcInspRefundPreview();
    }
  },

  populateInspSwapCars(searchKw = "") {
    const listEl = document.getElementById("insp-swap-car-dropdown-list");
    if (!listEl) return;

    const bkId = document.getElementById("insp-bk-id")?.value;
    const currentBooking = (this.bookings || []).find(x => x.booking_id === bkId);
    const currentPlate = currentBooking?.car_id || "";

    // Show only cars that are Available ("ว่างพร้อมใช้งาน") and not the currently rented car
    const availableCars = (this.cars || []).filter(c => {
      const isAvailable = (c.status === "ว่างพร้อมใช้งาน" || c.status === "ว่าง" || !c.status);
      return isAvailable && c.plate !== currentPlate;
    });

    const kw = (searchKw || "").toLowerCase().trim();
    const filtered = availableCars.filter(c => {
      if (!kw) return true;
      const plateMatch = (c.plate || "").toLowerCase().includes(kw);
      const brandMatch = (c.brand || "").toLowerCase().includes(kw);
      const modelMatch = (c.model || "").toLowerCase().includes(kw);
      const colorMatch = (c.color || "").toLowerCase().includes(kw);
      return plateMatch || brandMatch || modelMatch || colorMatch;
    });

    if (filtered.length === 0) {
      listEl.innerHTML = `<div style="padding:10px 12px; color:#94A3B8; font-size:12px; text-align:center;">${availableCars.length === 0 ? "⚠️ ไม่มีรถยนต์ที่ว่างพร้อมใช้งานในขณะนี้" : `ไม่พบรถที่ตรงกับ "${kw}"`}</div>`;
      return;
    }

    const currentSelected = document.getElementById("insp-swap-selected-plate")?.value || "";
    listEl.innerHTML = filtered.map(c => {
      const isSelected = c.plate === currentSelected;
      const priceStr = c.price_day || c.daily_rate ? `฿${Number(c.price_day || c.daily_rate).toLocaleString()}/วัน` : '';
      return `
        <div class="insp-swap-car-option-item ${isSelected ? 'selected' : ''}" 
             onclick="app.selectInspSwapCar('${c.plate}')"
             title="${c.plate} - ${c.brand || ''} ${c.model || ''}">
          <div style="flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; padding-right:8px;">
            <span style="font-weight:800; color:#0F172A; margin-right:6px;">${c.plate}</span>
            <span style="color:#334155; font-weight:600;">${c.brand || ''} ${c.model || ''}</span>
            ${c.color ? `<span style="color:#64748B; font-size:11.5px; margin-left:4px;">(${c.color})</span>` : ''}
          </div>
          <div style="display:flex; align-items:center; gap:6px;">
            ${priceStr ? `<span style="font-size:11px; color:#D97706; font-weight:600;">${priceStr}</span>` : ''}
            <span style="font-size:11px; padding:2px 6px; border-radius:4px; font-weight:700; background:#ECFDF5; color:#065F46; white-space:nowrap;">
              ว่าง
            </span>
          </div>
        </div>
      `;
    }).join("");
  },

  showInspSwapCarDropdown(show = true) {
    const listEl = document.getElementById("insp-swap-car-dropdown-list");
    if (!listEl) return;
    if (show) {
      this.populateInspSwapCars(document.getElementById("insp-swap-car-search")?.value || "");
      listEl.style.display = "block";
    } else {
      listEl.style.display = "none";
    }
  },

  toggleInspSwapCarDropdown() {
    const listEl = document.getElementById("insp-swap-car-dropdown-list");
    if (!listEl) return;
    if (listEl.style.display === "none" || !listEl.style.display) {
      this.showInspSwapCarDropdown(true);
      document.getElementById("insp-swap-car-search")?.focus();
    } else {
      this.showInspSwapCarDropdown(false);
    }
  },

  filterInspSwapCars(kw) {
    this.populateInspSwapCars(kw);
    const listEl = document.getElementById("insp-swap-car-dropdown-list");
    if (listEl) listEl.style.display = "block";
  },

  selectInspSwapCar(plate) {
    const car = (this.cars || []).find(c => c.plate === plate);
    const searchInput = document.getElementById("insp-swap-car-search");
    const hiddenPlate = document.getElementById("insp-swap-selected-plate");
    const badgeEl = document.getElementById("insp-swap-selected-badge");

    if (car) {
      if (searchInput) searchInput.value = `${car.plate} - ${car.brand || ''} ${car.model || ''} (${car.color || ''})`;
      if (hiddenPlate) hiddenPlate.value = car.plate;
      if (badgeEl) {
        badgeEl.style.display = "block";
        badgeEl.innerHTML = `✅ <b>เลือกรถทดแทน:</b> <span style="font-weight:800; color:#065F46;">${car.plate}</span> (${car.brand || ''} ${car.model || ''}) — ลูกค้าจะได้รับรถคันนี้ไปใช้งานต่อจนครบกำหนดสัญญา`;
      }
    }
    this.showInspSwapCarDropdown(false);
  },

  recalcInspRefundPreview() {
    const depAmt = 5000; // STRICT RULE: Fixed 5,000 THB deposit always
    const repCost = parseFloat(document.getElementById("insp-repair-cost")?.value || 0);
    const isRepair = document.getElementById("insp-cond-repair")?.checked;
    const isSwap = document.getElementById("insp-sub-swap-car")?.checked;
    const confirmRefund = document.getElementById("insp-confirm-refund-deposit")?.checked !== false;

    const prevEl = document.getElementById("insp-deposit-calc-preview");
    const refundBox = document.getElementById("insp-deposit-refund-confirm-box");
    const badgeEl = document.getElementById("insp-refund-amount-badge");

    const deducted = isRepair ? Math.min(repCost, depAmt) : 0;
    const refund = Math.max(0, depAmt - deducted);

    if (refundBox) {
      refundBox.style.display = (isRepair && isSwap) ? "none" : "block";
    }
    if (badgeEl) {
      if (!confirmRefund) {
        badgeEl.textContent = "ยังไม่คืนตอนนี้ (฿0.00)";
        badgeEl.style.background = "#64748B";
      } else {
        badgeEl.textContent = `คืนสุทธิ ฿${refund.toLocaleString('th-TH', {minimumFractionDigits: 2})}`;
        badgeEl.style.background = refund > 0 ? "#059669" : "#DC2626";
      }
    }

    if (!prevEl) return;

    if (isRepair) {
      if (isSwap) {
        prevEl.style.display = "none";
        return;
      }
      prevEl.style.display = "block";
      prevEl.innerHTML = `
        💵 <b>สรุปการเงินมัดจำ:</b> มัดจำเดิม ฿5,000 | หักค่าซ่อม ฿${deducted.toLocaleString()} | <b>คืนมัดจำสุทธิ: <span style="color:#15803D;">฿${refund.toLocaleString()}</span></b>
      `;
    } else {
      prevEl.style.display = "block";
      prevEl.innerHTML = `
        💵 <b>คืนเงินมัดจำเต็มจำนวน:</b> <b style="color:#15803D;">฿5,000</b>
      `;
    }
  },

  openSettleModal(bkId) {
    const b = (this.bookings || []).find(x => x.booking_id === bkId);
    if (!b) return;
    const netP = parseFloat(b.net_price || 0);
    const depAmt = parseFloat(b.deposit_amount || 5000);
    const isDep = Boolean(b.deposit_paid);
    const isRent = Boolean(b.rental_paid);
    const ver = parseInt(b.pricing_version || 1, 10);
    const remP = this.computeBookingRemainingBalance
      ? this.computeBookingRemainingBalance(b)
      : (isRent ? 0 : (ver >= 2 ? netP : (isDep ? Math.max(0, netP - depAmt) : parseFloat(b.remaining_rental !== undefined ? b.remaining_rental : netP))));
    
    document.getElementById("modal-settle-bk-id").value = bkId;
    const sumEl = document.getElementById("modal-settle-summary");
    if (sumEl) {
      const delFee = parseFloat(b.delivery_fee || 0);
      const picFee = parseFloat(b.pickup_fee || 0);
      const feeNote = (delFee + picFee > 0) ? ` (รวมค่ารับ-ส่ง ฿${(delFee + picFee).toLocaleString()})` : '';
      const depNote = isDep
        ? (ver >= 2 ? `| <b>เงินประกันรับแล้ว:</b> ฿${depAmt.toLocaleString()} (แยกต่างหาก)` : `| <b>หักเงินมัดจำ:</b> ฿${depAmt.toLocaleString()}`)
        : '';
      sumEl.innerHTML = `
        <b>รหัสการจอง:</b> <span style="color:#C2410C;">${b.booking_id}</span> | <b>ทะเบียน:</b> ${b.car_id}<br/>
        <b>ผู้เช่า:</b> ${b.customer} | <b>ยอดบริการรวม:</b> ฿${netP.toLocaleString()}${feeNote} ${depNote}
      `;
    }
    const amtEl = document.getElementById("modal-settle-amount");
    if (amtEl) amtEl.value = `฿${remP.toLocaleString('th-TH', {minimumFractionDigits: 2})}`;

    const refEl = document.getElementById("modal-settle-ref");
    if (refEl) refEl.value = b.rental_ref || "";
    const slipEl = document.getElementById("modal-settle-slip-url");
    if (slipEl) slipEl.value = b.rental_slip || "";

    this.openModal("modal-settle-rental");
  },

  async handleSettleSlipUpload(input) {
    if (!input.files || input.files.length === 0) return;
    const file = input.files[0];
    const formData = new FormData();
    formData.append("file", file);
    try {
      this.showToast(`กำลังอัปโหลดสลิป ${file.name}...`, "info");
      const bkId = document.getElementById("modal-settle-bk-id")?.value || "";
      const uploadUrl = `/api/upload-photo?category=slip&ref_id=${encodeURIComponent(bkId || 'SETTLE')}`;
      const res = await fetch(uploadUrl, { method: "POST", body: formData });
      const data = await res.json();
      if (data.success && data.url) {
        document.getElementById("modal-settle-slip-url").value = data.url;
        this.showToast("📸 อัปโหลดสลิปเรียบร้อย!", "success");
      }
    } catch (e) {
      this.showToast("อัปโหลดไม่สำเร็จ: " + e.message, "danger");
    }
  },

  async submitSettleFromModal() {
    const bkId = document.getElementById("modal-settle-bk-id")?.value;
    if (!bkId) return;
    const method = document.getElementById("modal-settle-method")?.value || "โอนเงิน / สแกน QR";
    const ref = (document.getElementById("modal-settle-ref")?.value || "").trim();
    const slip = (document.getElementById("modal-settle-slip-url")?.value || "").trim();

    try {
      this.showToast(`⏳ กำลังบันทึกชำระค่าเช่า ${bkId}...`, "info");
      const res = await fetch(`/api/bookings/${bkId}/settle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          payment_method: method,
          payment_ref: ref,
          rental_ref: ref,
          slip_url: slip,
          rental_slip: slip,
          remaining_slip_link: slip
        })
      });
      const data = await res.json();
      if (data.success) {
        this.closeModal("modal-settle-rental");
        this.showToast(`🎉 ชำระค่าเช่าสำหรับ ${bkId} เรียบร้อย! พร้อมจัดทำสัญญาเช่า`, "success");
        await this.loadBookings();
        if (this.activeTab === "contract") this.onSelectContractBooking();
        if (this.activeTab === "assign") {
          this.onSelectAssignDispBooking();
          this.onSelectAssignRetBooking();
        }
        if (this.activeTab === "deposit") this.onSelectDepositBooking();
      } else {
        throw new Error(data.detail || "ชำระค่าเช่าไม่สำเร็จ");
      }
    } catch (e) {
      alert(e.message);
      this.showToast("เกิดข้อผิดพลาด: " + e.message, "danger");
    }
  },

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
  },

  updateCheckinImgPreview(angle, url) {
    const previewContainer = document.getElementById(`preview-checkin-img-${angle}`);
    if (!previewContainer) return;
    const directSrc = this.convertDriveUrl(url);
    const imgEl = previewContainer.querySelector("img");
    if (directSrc && imgEl) {
      imgEl.src = directSrc;
      previewContainer.style.display = "block";
    } else {
      previewContainer.style.display = "none";
      if (imgEl) imgEl.src = "";
    }
  },

  async uploadCheckinAnglePhoto(input, angle) {
    if (!input.files || input.files.length === 0) return;
    const file = input.files[0];
    const formData = new FormData();
    formData.append("file", file);

    const bkId = document.getElementById("insp-bk-id")?.value;
    const b = (this.bookings || []).find(x => x.booking_id === bkId);
    const plate = b?.car_id || "CAR";

    try {
      this.showToast(`กำลังอัปโหลดรูปรถด้าน ${angle} (${file.name})...`, "info");
      const url = `/api/upload-photo?category=car&plate=${encodeURIComponent(plate)}&sub_type=${encodeURIComponent(angle)}`;
      const res = await fetch(url, { method: "POST", body: formData });
      const data = await res.json();
      if (data.success && data.url) {
        const inp = document.getElementById(`insp-checkin-img-${angle}`);
        if (inp) inp.value = data.webViewLink || data.url;
        this.updateCheckinImgPreview(angle, data.webViewLink || data.url);
        this.showToast(`📸 อัปโหลดรูปรถด้าน ${angle} เรียบร้อย!`, "success");
      }
    } catch (e) {
      this.showToast(`อัปโหลดรูปรถด้าน ${angle} ไม่สำเร็จ: ` + e.message, "danger");
    }
  },

  async uploadInsuranceDoc(input, subType = "กรมธรรม์") {
    if (!input.files || input.files.length === 0) return;
    const file = input.files[0];
    const formData = new FormData();
    formData.append("file", file);
    const plate = document.getElementById("edit-car-plate")?.value || "CAR";

    try {
      this.showToast(`กำลังอัปโหลดเอกสาร ${subType} (${file.name})...`, "info");
      const url = `/api/upload-photo?category=insurance&plate=${encodeURIComponent(plate)}&sub_type=${encodeURIComponent(subType)}`;
      const res = await fetch(url, { method: "POST", body: formData });
      const data = await res.json();
      if (data.success && data.url) {
        const inp = document.getElementById("edit-car-ins-doc-url");
        if (inp) inp.value = data.webViewLink || data.url;
        this.updateCarFormField('ins_doc_url', data.webViewLink || data.url);
        this.showToast(`📄 อัปโหลดเอกสาร ${subType} เรียบร้อย!`, "success");
      }
    } catch (e) {
      this.showToast(`อัปโหลดเอกสารไม่สำเร็จ: ` + e.message, "danger");
    }
  },

  async submitInspection() {
    const bkId = document.getElementById("insp-bk-id").value;
    const jobType = document.getElementById("insp-job-type").value;
    const fuel = document.getElementById("insp-fuel-select").value;
    const mileage = document.getElementById("insp-mileage-input").value;
    const notes = document.getElementById("insp-notes-input").value;
    const isRepair = document.getElementById("insp-cond-repair")?.checked;
    const damageDesc = (document.getElementById("insp-damage-desc")?.value || "").trim();
    const repairCost = parseFloat(document.getElementById("insp-repair-cost")?.value || 0);
    const serviceCenter = (document.getElementById("insp-service-center")?.value || "").trim();

    // Check Branch B sub-option (end_contract vs swap_vehicle)
    let branchBAction = "end_contract";
    let swapNewPlate = "";
    if (jobType === "Return" && isRepair) {
      const isSwap = document.getElementById("insp-sub-swap-car")?.checked;
      if (isSwap) {
        branchBAction = "swap_vehicle";
        swapNewPlate = (document.getElementById("insp-swap-selected-plate")?.value || "").trim();
        if (!swapNewPlate) {
          alert("⚠️ กรุณาเลือกรถคันใหม่สำหรับเปลี่ยนทดแทนให้ลูกค้าก่อนกดยืนยัน");
          return;
        }
      }
    }

    const imgFront = (document.getElementById("insp-checkin-img-front")?.value || "").trim();
    const imgLeft = (document.getElementById("insp-checkin-img-left")?.value || "").trim();
    const imgRear = (document.getElementById("insp-checkin-img-rear")?.value || "").trim();
    const imgRight = (document.getElementById("insp-checkin-img-right")?.value || "").trim();

    const diagramBase64 = this.getCarDiagramBase64();
    const curDamageMarks = Array.isArray(this.damageMarks) ? [...this.damageMarks] : [];

    const payload = {
      fuel_level: fuel,
      mileage: mileage,
      notes: notes,
      photos: this.uploadedPhotos,
      condition: (jobType === "Return" && isRepair) ? "needs_repair" : "normal",
      damage_desc: damageDesc,
      repair_cost: repairCost,
      service_center: serviceCenter,
      action: branchBAction,
      new_car_id: swapNewPlate,
      car_diagram: diagramBase64,
      damage_marks: curDamageMarks
    };

    if (jobType === "Return") {
      payload.checkin_img_front = imgFront;
      payload.checkin_img_left = imgLeft;
      payload.checkin_img_rear = imgRear;
      payload.checkin_img_right = imgRight;
      payload.refund_deposit = document.getElementById("insp-confirm-refund-deposit")?.checked !== false;
      payload.refund_method = document.getElementById("insp-refund-method")?.value || "โอนเงินคืนบัญชีลูกค้า";
      payload.refund_ref = (document.getElementById("insp-refund-ref")?.value || "").trim();
    }

    // TARGET MISSION 2 & 3: Generate official inspection checklist PDF
    let genPdfUrl = null;
    try {
      const bObj = (this.bookings || []).find(x => x.booking_id === bkId);
      const genRes = await fetch(`/api/bookings/${bkId}/generate-inspection-pdf`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          inspection_type: jobType === "Dispatch" ? "checkout" : "checkin",
          odometer: mileage,
          odometer_out: jobType === "Dispatch" ? mileage : undefined,
          odometer_in: jobType !== "Dispatch" ? mileage : undefined,
          fuel_level: fuel,
          fuel_out: jobType === "Dispatch" ? fuel : undefined,
          fuel_in: jobType !== "Dispatch" ? fuel : undefined,
          notes: notes,
          remarks: notes,
          damage_notes: notes,
          damage_desc: damageDesc,
          car_diagram: diagramBase64,
          car_diagram_out: jobType === "Dispatch" ? diagramBase64 : undefined,
          car_diagram_in: jobType !== "Dispatch" ? diagramBase64 : undefined,
          damage_marks: curDamageMarks,
          damage_marks_out: jobType === "Dispatch" ? curDamageMarks : undefined,
          damage_marks_in: jobType !== "Dispatch" ? curDamageMarks : undefined,
          checkin_img_front: jobType === "Return" ? imgFront : undefined,
          checkin_img_left: jobType === "Return" ? imgLeft : undefined,
          checkin_img_rear: jobType === "Return" ? imgRear : undefined,
          checkin_img_right: jobType === "Return" ? imgRight : undefined,
          inspection_categories: bObj?.inspection_categories || (jobType === "Dispatch" ? bObj?.inspection_categories_out : bObj?.inspection_categories_in) || {
            petrol: true, cleanliness: true, tires: true, interior: true, underhood: true
          },
          staff_name: (jobType === "Dispatch" ? bObj?.worker_delivery : bObj?.worker_return) || "Staff",
          customer_signature: bObj?.customer || "Customer"
        })
      });
      const genData = await genRes.json();
      if (!genRes.ok) {
        this.showToast(genData.detail || "เกิดข้อผิดพลาดในการบันทึกเลขไมล์", "error");
        return;
      }
      if (genData.success && genData.pdf_url) {
        genPdfUrl = genData.pdf_url;
        if (bObj) {
          if (jobType === "Dispatch") bObj.checkout_pdf_url = genPdfUrl;
          else bObj.checkin_pdf_url = genPdfUrl;
        }
      }
    } catch (pdfErr) {
      console.warn("[Inspection PDF] Notice generating inspection checklist PDF:", pdfErr);
    }

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
        const bObj = (this.bookings || []).find(x => x.booking_id === bkId);
        if (bObj && jobType === "Return") {
          bObj.checkin_img_front = imgFront;
          bObj.checkin_img_left = imgLeft;
          bObj.checkin_img_rear = imgRear;
          bObj.checkin_img_right = imgRight;
        }
        if (jobType === "Return" && isRepair) {
          if (branchBAction === "swap_vehicle") {
            this.showToast(`🔄 สลับรถทดแทนเป็น ${swapNewPlate} เรียบร้อย (รถเดิมเข้าซ่อมบำรุง & แขวนยอดค่าเสียหาย ฿${repairCost.toLocaleString()})`, "success");
          } else {
            this.showToast(`⚠️ รับคืนรถ ${bkId} เรียบร้อย (ส่งซ่อมบำรุง & หักมัดจำ ฿${repairCost.toLocaleString()})`, "warning");
          }
        } else {
          this.showToast(`🎉 ปิดงาน ${jobType} สำหรับ ${bkId} สมบูรณ์!`, "success");
        }
        if (typeof Swal !== "undefined" && genPdfUrl) {
          Swal.fire({
            icon: 'success',
            title: jobType === 'Dispatch' ? 'ส่งมอบรถสำเร็จ!' : 'รับรถคืนสำเร็จ!',
            html: `
              <p style="color:#475569; font-size:13.5px; margin-bottom:14px;">ระบบได้สร้างเอกสารใบตรวจสภาพรถยนต์ (Inspection Checklist PDF) พร้อมบันทึกลงฐานข้อมูลเรียบร้อยแล้ว</p>
              <a href="${genPdfUrl}" target="_blank" class="btn btn-primary" style="font-weight:700; padding:10px 20px; font-size:14px; text-decoration:none; display:inline-block; background:#EA580C; border-color:#EA580C;">
                🖨️ พิมพ์ใบตรวจสภาพรถ (Print Inspection PDF)
              </a>
            `,
            showConfirmButton: true,
            confirmButtonText: 'ปิดหน้าต่าง'
          });
        }
        await this.loadBackOfficeJobs();
        await this.loadBookings();
        await this.loadCars();
        if (jobType === "Return") await this.loadDashboardKPIs();
        if (this.activeTab === "contract") this.onSelectContractBooking();
        if (this.activeTab === "assign") {
          this.onSelectAssignDispBooking();
          this.onSelectAssignRetBooking();
        }
      } else {
        throw new Error(data.detail || "ปิดงานไม่สำเร็จ");
      }
    } catch (e) {
      alert(e.message);
      this.showToast("เกิดข้อผิดพลาด: " + e.message, "danger");
    }
  }
});
