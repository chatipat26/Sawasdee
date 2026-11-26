/**
 * Sawasdee Rental - Bookings, Deposit/Settle, Dispatch/Return Assign, Contracts & Pipeline
 * Prototype Mixin for App
 */
Object.assign(App.prototype, {
  openBookModal(plate) {
    try {
      const cleanPlate = String(plate || "").trim();
      const car = (this.cars || []).find(c => c.plate === cleanPlate || (this.normalizePlate && this.normalizePlate(c.plate) === this.normalizePlate(cleanPlate))) || { plate: cleanPlate, brand: "", model: "", price_day: 1000 };

      const plateInp = document.getElementById("book-car-plate");
      if (plateInp) plateInp.value = car.plate || cleanPlate;

      const thNow = this.getThaiDateTime ? this.getThaiDateTime(0) : { date: new Date().toISOString().split("T")[0], time: "10:00" };
      const thNext3 = this.getThaiDateTime ? this.getThaiDateTime(3) : { date: new Date(Date.now() + 3*86400000).toISOString().split("T")[0], time: "10:00" };

      // Read directly from DOM Instant Booking Bar inputs to prevent lost references
      const rawSDate = document.getElementById("filter-start-date")?.value;
      const rawSTime = document.getElementById("filter-start-time")?.value;
      const rawEDate = document.getElementById("filter-end-date")?.value;
      const rawETime = document.getElementById("filter-end-time")?.value;

      let fSDate = rawSDate && rawSDate.trim() ? rawSDate.trim() : thNow.date;
      let fSTime = rawSTime && rawSTime.trim() ? rawSTime.trim() : thNow.time;
      let fEDate = rawEDate && rawEDate.trim() ? rawEDate.trim() : (fSDate || thNext3.date);
      let fETime = rawETime && rawETime.trim() ? rawETime.trim() : fSTime;

      // Prevent backdated booking
      if (fSDate < thNow.date) {
        fSDate = thNow.date;
      }
      if (fEDate < fSDate) {
        fEDate = fSDate;
      }

      const mSDate = document.getElementById("book-modal-start-date");
      const mSTime = document.getElementById("book-modal-start-time");
      const mEDate = document.getElementById("book-modal-end-date");
      const mETime = document.getElementById("book-modal-end-time");

      if (mSDate) {
        mSDate.value = fSDate;
        mSDate.min = thNow.date;
      }
      if (mSTime) mSTime.value = fSTime;
      if (mEDate) {
        mEDate.value = fEDate;
        mEDate.min = fSDate;
      }
      if (mETime) mETime.value = fETime;

      const discInp = document.getElementById("book-discount-input");
      if (discInp) discInp.value = 0;

      // Reset off-site delivery & pickup controls
      const delBranchRad = document.getElementById("book-del-mode-branch");
      const picBranchRad = document.getElementById("book-pic-mode-branch");
      if (delBranchRad) delBranchRad.checked = true;
      if (picBranchRad) picBranchRad.checked = true;
      const delFeeInp = document.getElementById("book-delivery-fee-input");
      const picFeeInp = document.getElementById("book-pickup-fee-input");
      if (delFeeInp) delFeeInp.value = 0;
      if (picFeeInp) picFeeInp.value = 0;
      const locDelInp = document.getElementById("book-loc-delivery");
      const locRetInp = document.getElementById("book-loc-return");
      if (locDelInp) locDelInp.value = "Sukhumvit";
      if (locRetInp) locRetInp.value = "Sukhumvit";
      this.onBookDeliveryModeChange();

      this.recalcBookingModalFromDates(true);
      this.populateCustomerDropdowns(this.lastAddedCustomerName || null);
      this.openModal("modal-book-car");
    } catch (err) {
      console.error("openBookModal error:", err);
      this.showToast("เกิดข้อผิดพลาดในการเปิดหน้าต่างจอง: " + err.message, "danger");
    }
  },

  setBookingModalDurationDays(targetDays) {
    const sDateInput = document.getElementById("book-modal-start-date");
    const eDateInput = document.getElementById("book-modal-end-date");
    if (!sDateInput || !eDateInput || !sDateInput.value) return;

    let [y, m, d] = sDateInput.value.split("-").map(n => parseInt(n, 10));
    if (y > 2400) y -= 543;
    const target = new Date(y, m - 1, d + targetDays);
    const yyyy = target.getFullYear();
    const mm = String(target.getMonth() + 1).padStart(2, "0");
    const dd = String(target.getDate()).padStart(2, "0");
    eDateInput.value = `${yyyy}-${mm}-${dd}`;
    this.recalcBookingModalFromDates(false);
  },

  recalcBookingModalFromDates(fromDateChange = false) {
    const plate = document.getElementById("book-car-plate")?.value;
    const car = this.cars.find(c => c.plate === plate) || { brand: "", model: "", plate: plate || "-", price_day: 1000 };
    const thNow = this.getThaiDateTime(0);
    const mSDate = document.getElementById("book-modal-start-date");
    const mEDate = document.getElementById("book-modal-end-date");

    if (mSDate) {
      if (!mSDate.min) mSDate.min = thNow.date;
      if (mSDate.value && mSDate.value < thNow.date) {
        mSDate.value = thNow.date;
      }
    }
    if (mEDate && mSDate) {
      mEDate.min = mSDate.value || thNow.date;
      if (mEDate.value && mEDate.value < mSDate.value) {
        mEDate.value = mSDate.value;
      }
    }

    const sDate = mSDate?.value || thNow.date;
    const sTime = document.getElementById("book-modal-start-time")?.value || thNow.time;
    const eDate = mEDate?.value || thNow.date;
    const eTime = document.getElementById("book-modal-end-time")?.value || thNow.time;

    const start = new Date(`${sDate}T${sTime}`);
    const end = new Date(`${eDate}T${eTime}`);

    let days = 1;
    let baseDays = 1;
    let extraHours = 0;
    let remMins = 0;
    let isOver4 = false;
    let isInvalidDate = false;

    if (end <= start) {
      days = 1;
      baseDays = 1;
      isInvalidDate = true;
    } else {
      const diffMs = end - start;
      const totalHours = Math.floor(diffMs / (1000 * 60 * 60));
      remMins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
      baseDays = Math.floor(totalHours / 24);
      extraHours = totalHours % 24;
      if (extraHours > 4 || (extraHours === 4 && remMins > 0)) {
        days = baseDays + 1;
        isOver4 = true;
      } else {
        days = Math.max(1, baseDays);
      }
    }

    const cTypeEl = document.getElementById("book-contract-type");
    if (fromDateChange && cTypeEl) {
      if (days >= 30) {
        cTypeEl.value = "รายเดือน";
      } else if (days >= 7) {
        cTypeEl.value = "รายสัปดาห์";
      } else {
        cTypeEl.value = "รายวัน";
      }
    }

    const cType = cTypeEl?.value || "รายวัน";
    const { basePrice, breakdownText, priceDay, priceWeek, priceMonth } = this.calculateCarRentalPrice(car, days, cType);

    // 1. Render Day & Duration Counter Box (Screenshot 1: เพิ่มตัวเลขการนับวัน)
    const durationBox = document.getElementById("book-modal-duration-box");
    if (durationBox) {
      let statusNotice = "";
      let boxBorder = "#BFDBFE";
      let boxBg = "#EFF6FF";

      if (isInvalidDate) {
        boxBorder = "#FCA5A5";
        boxBg = "#FEF2F2";
        statusNotice = `<span style="color:#DC2626; font-size:12px; font-weight:700;">⚠️ วัน-เวลาคืนรถต้องอยู่หลังเวลารับรถ (ระบบคำนวณขั้นต่ำคิดเป็น 1 วัน)</span>`;
      } else if (isOver4) {
        boxBorder = "#FDBA74";
        boxBg = "#FFF7ED";
        statusNotice = `<span style="color:#C2410C; font-size:12px;">⚠️ คืนรถเกินเวลา <b>${extraHours} ชม. ${remMins} นาที</b> (เกิน 4 ชม. ปรับคิดเพิ่ม 1 วันเต็ม ➔ คิดรวม <b>${days} วัน</b>)</span>`;
      } else if (extraHours > 0 || remMins > 0) {
        boxBorder = "#BFDBFE";
        boxBg = "#EFF6FF";
        statusNotice = `<span style="color:#1D4ED8; font-size:12px;">⏱️ เกินเวลา <b>${extraHours} ชม. ${remMins} นาที</b> (อนุโลมไม่เกิน 4 ชม. ไม่คิดวันเพิ่ม ➔ คิด <b>${days} วัน</b>)</span>`;
      } else {
        boxBorder = "#BBF7D0";
        boxBg = "#F0FDF4";
        statusNotice = `<span style="color:#15803D; font-size:12px;">🟢 ตรงเวลาพอดี <b>${days} วันเต็ม</b> (${days * 24} ชั่วโมง)</span>`;
      }

      let quickAdjustHtml = "";
      if (cType === "รายสัปดาห์" && days < 7) {
        quickAdjustHtml = `
          <button type="button" onclick="app.setBookingModalDurationDays(7)" style="margin-left:auto; background:#FFFFFF; border:1px solid #3B82F6; color:#1D4ED8; padding:3px 9px; border-radius:6px; font-size:11.5px; font-weight:700; cursor:pointer;" title="ปรับวันคืนรถให้ครบ 7 วันพอดี">
            ⚡ ปรับวันคืนรถเป็น 7 วัน (1 สัปดาห์)
          </button>
        `;
      } else if (cType === "รายเดือน" && days < 30) {
        quickAdjustHtml = `
          <button type="button" onclick="app.setBookingModalDurationDays(30)" style="margin-left:auto; background:#FFFFFF; border:1px solid #3B82F6; color:#1D4ED8; padding:3px 9px; border-radius:6px; font-size:11.5px; font-weight:700; cursor:pointer;" title="ปรับวันคืนรถให้ครบ 30 วันพอดี">
            ⚡ ปรับวันคืนรถเป็น 30 วัน (1 เดือน)
          </button>
        `;
      }

      durationBox.style.background = boxBg;
      durationBox.style.borderColor = boxBorder;
      durationBox.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; margin-bottom:6px;">
          <div style="display:flex; align-items:center; gap:8px;">
            <span style="font-size:13.5px; font-weight:700; color:#1E293B;">จำนวนวันเช่ารวม:</span>
            <span style="background:#1D4ED8; color:#FFFFFF; font-size:15px; font-weight:800; padding:3px 14px; border-radius:20px; box-shadow:0 1px 3px rgba(0,0,0,0.12);">
              ${days} วัน
            </span>
          </div>
          ${quickAdjustHtml}
        </div>
        <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
          ${statusNotice}
        </div>
      `;
    }

    // 2. Render Top Car Preview Box (Clean professional layout)
    const preview = document.getElementById("book-car-preview");
    if (preview) {
      const activeStyle = "background:#FFFBEB; color:#B45309; border:1.5px solid #F59E0B; font-weight:800;";
      const inactiveStyle = "background:#F1F5F9; color:#475569; border:1px solid #E2E8F0;";

      preview.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:8px;">
          <div>
            <b style="font-size:15px; color:#1E293B;">${car.brand || ''} ${car.model || ''}</b> | ทะเบียน: <b style="color:#D97706;">${car.plate}</b><br/>
            <span style="font-size:12px; color:#64748B;">กลุ่ม: ${car.car_group || 'รถยนต์'} | เชื้อเพลิง: ${car.fuel_type || car.fuel_system || 'เบนซิน'} | ผู้ถือกรรมสิทธิ์: ${car.owner_company || car.company || '-'}</span>
          </div>
          <div style="text-align:right;">
            <div style="font-size:11px; color:#64748B; margin-bottom:3px;">อัตราค่าเช่า:</div>
            <div style="display:flex; gap:4px; font-size:11.5px; justify-content:flex-end; flex-wrap:wrap;">
              <span style="padding:2px 7px; border-radius:6px; ${cType === 'รายวัน' ? activeStyle : inactiveStyle}">฿${priceDay.toLocaleString()}/วัน</span>
              <span style="padding:2px 7px; border-radius:6px; ${cType === 'รายสัปดาห์' ? activeStyle : inactiveStyle}">฿${priceWeek.toLocaleString()}/สัปดาห์</span>
              <span style="padding:2px 7px; border-radius:6px; ${cType === 'รายเดือน' ? activeStyle : inactiveStyle}">฿${priceMonth.toLocaleString()}/เดือน</span>
            </div>
          </div>
        </div>
        <div style="margin-top:7px; padding-top:6px; border-top:1px dashed #E2E8F0; font-size:12px; color:#475569;">
          <b>การคำนวณราคา (${cType}):</b> <span style="color:#D97706; font-weight:700;">${breakdownText}</span>
        </div>
      `;
    }

    const pInput = document.getElementById("book-price-input");
    if (pInput) pInput.value = basePrice;
    this.recalcBookingModalPrice();
  },

  onBookDeliveryModeChange() {
    const isDelOffsite = Boolean(document.getElementById("book-del-mode-offsite")?.checked);
    const isPicOffsite = Boolean(document.getElementById("book-pic-mode-offsite")?.checked);
    const delWrap = document.getElementById("book-delivery-fee-wrap");
    const picWrap = document.getElementById("book-pickup-fee-wrap");
    const delFeeInp = document.getElementById("book-delivery-fee-input");
    const picFeeInp = document.getElementById("book-pickup-fee-input");
    const locDelInp = document.getElementById("book-loc-delivery");
    const locRetInp = document.getElementById("book-loc-return");

    if (delWrap) delWrap.style.display = isDelOffsite ? "block" : "none";
    if (!isDelOffsite && delFeeInp) delFeeInp.value = 0;
    if (!isDelOffsite && locDelInp && !locDelInp.value.trim()) locDelInp.value = "Sukhumvit";

    if (picWrap) picWrap.style.display = isPicOffsite ? "block" : "none";
    if (!isPicOffsite && picFeeInp) picFeeInp.value = 0;
    if (!isPicOffsite && locRetInp && !locRetInp.value.trim()) locRetInp.value = "Sukhumvit";

    this.recalcBookingModalPrice();
  },

  recalcBookingModalPrice() {
    const p = parseFloat(document.getElementById("book-price-input")?.value || 0);
    const d = parseFloat(document.getElementById("book-discount-input")?.value || 0);
    const isDelOffsite = Boolean(document.getElementById("book-del-mode-offsite")?.checked);
    const isPicOffsite = Boolean(document.getElementById("book-pic-mode-offsite")?.checked);
    let delFee = isDelOffsite ? parseFloat(document.getElementById("book-delivery-fee-input")?.value || 0) : 0;
    let picFee = isPicOffsite ? parseFloat(document.getElementById("book-pickup-fee-input")?.value || 0) : 0;

    if (delFee < 0) delFee = 0;
    if (picFee < 0) picFee = 0;
    if (delFee > 10000) {
      delFee = 10000;
      const el = document.getElementById("book-delivery-fee-input");
      if (el) el.value = 10000;
      this.showToast("⚠️ ค่าส่งรถต่อเที่ยวจำกัดไม่เกิน ฿10,000", "warning");
    }
    if (picFee > 10000) {
      picFee = 10000;
      const el = document.getElementById("book-pickup-fee-input");
      if (el) el.value = 10000;
      this.showToast("⚠️ ค่ารับรถคืนต่อเที่ยวจำกัดไม่เกิน ฿10,000", "warning");
    }

    const rentalNet = Math.max(0, p - d);
    const net = rentalNet + delFee + picFee;
    const netEl = document.getElementById("book-modal-net-price");
    if (netEl) netEl.textContent = `฿${net.toLocaleString('th-TH', {minimumFractionDigits: 2})}`;

    const brkEl = document.getElementById("book-modal-fee-breakdown");
    if (brkEl) {
      if (delFee > 0 || picFee > 0) {
        brkEl.style.display = "block";
        brkEl.innerHTML = `ค่าเช่าหลังหักส่วนลด: <b>฿${rentalNet.toLocaleString()}</b>`
          + (delFee > 0 ? ` + ค่าส่งรถนอกสถานที่: <b>฿${delFee.toLocaleString()}</b>` : "")
          + (picFee > 0 ? ` + ค่ารับรถคืนนอกสถานที่: <b>฿${picFee.toLocaleString()}</b>` : "");
      } else {
        brkEl.style.display = "none";
        brkEl.innerHTML = "";
      }
    }
  },

  findBookingConflict(plate, sDate, eDate, excludeId = null) {
    if (!plate || !sDate || !eDate) return null;
    const norm = (v) => String(v || "").split("T")[0];
    return (this.bookings || []).find(b => {
      if (b.car_id !== plate) return false;
      if (excludeId && b.booking_id === excludeId) return false;
      if (b.status === "เสร็จสิ้น" || b.status === "ยกเลิก") return false;
      const bs = norm(b.start_date), be = norm(b.end_date);
      if (!bs || !be) return false;
      return !(be < sDate || bs > eDate);
    }) || null;
  },

  async submitInstantBooking() {
    const thNow = this.getThaiDateTime(0);
    const plate = document.getElementById("book-car-plate").value;
    const cust = document.getElementById("book-cust-select").value;
    const cType = document.getElementById("book-contract-type").value;
    const sDate = document.getElementById("book-modal-start-date")?.value || document.getElementById("filter-start-date").value;
    const sTime = document.getElementById("book-modal-start-time")?.value || document.getElementById("filter-start-time").value || thNow.time;
    const eDate = document.getElementById("book-modal-end-date")?.value || document.getElementById("filter-end-date").value;
    const eTime = document.getElementById("book-modal-end-time")?.value || document.getElementById("filter-end-time").value || thNow.time;
    const baseP = parseFloat(document.getElementById("book-price-input").value);
    const disc = parseFloat(document.getElementById("book-discount-input").value || 0);

    // Validation: prevent backdated booking / contracts
    if (sDate < thNow.date) {
      alert(`⚠️ ไม่อนุญาตให้ทำสัญญาหรือจองรถย้อนหลัง!\nวันที่เริ่มต้น (${sDate}) ต้องไม่น้อยกว่าวันนี้ (${thNow.date})`);
      this.showToast(`⚠️ ไม่อนุญาตให้ทำสัญญาย้อนหลัง: วันที่เริ่มต้นต้องเป็น ${thNow.date} ขึ้นไป`, "danger");
      return;
    }
    if (eDate < sDate) {
      alert(`⚠️ วันที่สิ้นสุดสัญญา (${eDate}) ต้องไม่น้อยกว่าวันที่เริ่มต้น (${sDate})`);
      this.showToast(`⚠️ วันที่สิ้นสุดสัญญาต้องไม่น้อยกว่าวันที่เริ่มต้น`, "danger");
      return;
    }

    const overlap = this.findBookingConflict(plate, sDate, eDate);
    if (overlap) {
      alert(`⚠️ ไม่สามารถจองได้: วันที่ทับซ้อนกับคิวเดิมของรถคันนี้\n\nรหัสจอง: ${overlap.booking_id}\nลูกค้า: ${overlap.customer}\nช่วงวันที่: ${overlap.start_date_formatted || overlap.start_date} - ${overlap.end_date_formatted || overlap.end_date}\n\nกรุณาเลือกช่วงวันที่อื่นที่ว่าง`);
      this.showToast("⚠️ วันที่ทับซ้อนกับคิวเดิม ระบบระงับการบันทึกการจอง", "danger");
      return;
    }

    const isDelOffsite = Boolean(document.getElementById("book-del-mode-offsite")?.checked);
    const isPicOffsite = Boolean(document.getElementById("book-pic-mode-offsite")?.checked);
    const delFee = isDelOffsite ? parseFloat(document.getElementById("book-delivery-fee-input")?.value || 0) : 0;
    const picFee = isPicOffsite ? parseFloat(document.getElementById("book-pickup-fee-input")?.value || 0) : 0;
    const locDel = (document.getElementById("book-loc-delivery")?.value || "").trim() || "Sukhumvit";
    const locRet = (document.getElementById("book-loc-return")?.value || "").trim() || locDel;

    if (delFee < 0 || picFee < 0 || delFee > 10000 || picFee > 10000) {
      alert("⚠️ ค่ารับ-ส่งรถนอกสถานที่ต้องอยู่ระหว่าง 0 ถึง 10,000 บาทต่อเที่ยว");
      return;
    }

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
      delivery_mode: isDelOffsite ? "offsite" : "branch",
      pickup_mode: isPicOffsite ? "offsite" : "branch",
      delivery_fee: delFee,
      pickup_fee: picFee,
      loc_delivery: locDel,
      loc_return: locRet,
      deposit_amount: 5000.0,
      created_by: this.user ? this.user.username : "admin"
    };

    try {
      const res = await fetch("/api/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      let data = {};
      const resText = await res.text();
      try {
        data = JSON.parse(resText);
      } catch (jsonErr) {
        throw new Error(`เซิร์ฟเวอร์ตอบกลับไม่ถูกต้อง (HTTP ${res.status}): ${resText.slice(0, 160) || res.statusText}`);
      }
      if (!res.ok) {
        throw new Error(data.detail || data.error || "ไม่สามารถสร้างรายการจองได้");
      }
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
      alert(`❌ สร้างรายการจองไม่สำเร็จ:\n${e.message}`);
      this.showToast("เกิดข้อผิดพลาดในการสร้างการจอง: " + e.message, "danger");
    }
  },

  computeBookingRemainingBalance(b) {
    if (!b) return 0;
    if (b.rental_paid || b.is_fully_paid) return 0;
    if (b.remaining_rental !== undefined && b.remaining_rental !== null && b.remaining_rental !== "") {
      return Math.max(0, parseFloat(b.remaining_rental) || 0);
    }
    const netP = parseFloat(b.net_price || 0);
    const depAmt = parseFloat(b.deposit_amount || 5000);
    const ver = parseInt(b.pricing_version || 1, 10);
    if (ver >= 2) return Math.max(0, netP);
    return b.deposit_paid ? Math.max(0, netP - depAmt) : Math.max(0, netP);
  },

  populateBookingDropdowns() {
    const isEn = (this.currentLang === "EN");
    const depSel = document.getElementById("deposit-sel-booking");
    const assignDispSel = document.getElementById("assign-disp-bk");
    const assignRetSel = document.getElementById("assign-ret-bk");
    const contractSel = document.getElementById("contract-sel-bk");

    const activeBks = this.bookings.filter(b => b.status !== "ยกเลิก" && b.status !== "เสร็จสิ้น");
    const allValidBks = this.bookings.filter(b => b.status !== "ยกเลิก");

    const renderOpts = (bks) => `
      <option value="">-- ${isEn ? 'Please select a booking' : 'กรุณาเลือกรายการจอง'} --</option>
      ${bks.map(b => {
        const sFmt = b.start_date_formatted || b.start_date || "-";
        const eFmt = b.end_date_formatted || b.end_date || "-";
        return `<option value="${b.booking_id}">${b.booking_id} | ${b.car_id} (${b.customer}) 📅 ${sFmt} - ${eFmt} [${isEn ? 'Status' : 'สถานะ'}: ${b.status}]</option>`;
      }).join("")}
    `;

    if (depSel) {
      const cur = depSel.value;
      depSel.innerHTML = renderOpts(activeBks);
      if (cur) depSel.value = cur;
    }
    if (assignDispSel) {
      const cur = assignDispSel.value;
      assignDispSel.innerHTML = renderOpts(activeBks);
      if (cur) assignDispSel.value = cur;
    }
    if (assignRetSel) {
      const cur = assignRetSel.value;
      assignRetSel.innerHTML = renderOpts(activeBks);
      if (cur) assignRetSel.value = cur;
    }
    if (contractSel) {
      const cur = contractSel.value;
      contractSel.innerHTML = renderOpts(allValidBks.length > 0 ? allValidBks : this.bookings);
      if (cur) contractSel.value = cur;
    }
  },

  onSelectDepositBooking() {
    const isEn = (this.currentLang === "EN");
    const bkId = document.getElementById("deposit-sel-booking")?.value;
    const summary = document.getElementById("deposit-booking-summary");
    const actionSec = document.getElementById("deposit-action-section");
    const btnSettle = document.getElementById("btn-settle-rental");
    const btnDlDep = document.getElementById("btn-dl-dep-receipt");
    const btnDlRent = document.getElementById("btn-dl-rent-receipt");
    const btnDlContract = document.getElementById("btn-dl-contract-from-dep");
    const btnSaveSlip = document.getElementById("btn-save-slip-only");

    if (!bkId) {
      if (summary) summary.style.display = "none";
      if (actionSec) actionSec.style.display = "none";
      return;
    }

    const b = this.bookings.find(x => x.booking_id === bkId);
    if (!b) return;

    this.currentSelectedBooking = b;
    if (summary) summary.style.display = "block";
    if (actionSec) actionSec.style.display = "block";

    const isDep = b.deposit_paid;
    const isRent = b.rental_paid;
    const netP = parseFloat(b.net_price || 0);
    const depAmt = parseFloat(b.deposit_amount || 5000);
    const delFee = parseFloat(b.delivery_fee || 0);
    const picFee = parseFloat(b.pickup_fee || 0);
    const feesTotal = delFee + picFee;

    // 1. Populate amount & payment method (Fixed 5,000 THB)
    const amtEl = document.getElementById("deposit-amount-input");
    if (amtEl) amtEl.value = 5000;
    const methEl = document.getElementById("deposit-method-input");
    if (methEl && b.deposit_method) {
      methEl.value = b.deposit_method;
    }

    // 2. Populate ref number
    const refEl = document.getElementById("deposit-ref-input");
    if (refEl) {
      refEl.value = b.deposit_ref || b.rental_ref || "";
    }
    const alsoRentCb = document.getElementById("deposit-also-rent");
    if (alsoRentCb) {
      alsoRentCb.checked = Boolean(b.rental_paid || b.payment_type === "มัดจำและค่าเช่า");
    }
    const gdriveEl = document.getElementById("deposit-gdrive-input");
    if (gdriveEl) gdriveEl.value = b.google_drive_link || "";

    // 3. Populate slip URL and preview (Supports both 1 slip and 2 slips)
    const depSlip = b.deposit_slip || b.payment_slip_url || "";
    const rentSlip = b.remaining_slip_link || b.rental_slip || "";
    const hasDepSlip = Boolean(depSlip);
    const hasRentSlip = Boolean(rentSlip && rentSlip !== depSlip);

    const urlInput = document.getElementById("deposit-slip-url");
    if (urlInput) urlInput.value = depSlip || rentSlip || "";

    if (hasDepSlip) {
      this.showDepositSlipPreview(depSlip, isEn ? `Deposit Slip (${b.booking_id})` : `สลิปมัดจำ (${b.booking_id})`);
    } else if (rentSlip) {
      this.showDepositSlipPreview(rentSlip, isEn ? `Rental Fee Slip (${b.booking_id})` : `สลิปค่าเช่า (${b.booking_id})`);
    } else {
      this.clearDepositSlip(false);
    }

    // Secondary preview for rental balance slip if 2 separate slips exist
    const rentBox = document.getElementById("rental-slip-preview-box");
    const rentImg = document.getElementById("rental-slip-preview-img");
    const rentName = document.getElementById("rental-slip-preview-name");
    if (rentBox) {
      if (hasDepSlip && hasRentSlip) {
        this.currentRentalSlipUrl = rentSlip;
        rentBox.style.display = "flex";
        if (rentImg) rentImg.src = this.convertDriveUrl(rentSlip) || rentSlip;
        if (rentName) rentName.textContent = isEn ? `Rental Balance Slip (${b.booking_id})` : `สลิปชำระค่าเช่าคงเหลือ (${b.booking_id})`;
      } else {
        rentBox.style.display = "none";
        this.currentRentalSlipUrl = null;
      }
    }

    // 4. Render detailed summary with slip badges
    let slipBadges = [];
    if (b.deposit_ref) {
      slipBadges.push(`<span>🧾 <b>${isEn ? 'Slip Ref:' : 'เลขที่ Ref สลิป:'}</b> <code style="background:#FEF3C7; color:#92400E; padding:2px 7px; border-radius:4px; font-weight:700; font-size:12px;">${b.deposit_ref}</code></span>`);
    }
    if (depSlip) {
      slipBadges.push(`<span>📎 <b>${isEn ? 'Deposit Slip:' : 'สลิปมัดจำ:'}</b> <a href="javascript:void(0)" onclick="app.viewSlip('${depSlip}', '${isEn ? 'Deposit Slip' : 'สลิปมัดจำ'} (${b.booking_id})')" style="color:#0284C7; font-weight:700; text-decoration:underline; cursor:pointer;">🖼️ ${isEn ? 'Click to view slip' : 'ดูสลิปมัดจำ'}</a></span>`);
    }
    if (b.rental_ref && b.rental_ref !== b.deposit_ref) {
      slipBadges.push(`<span>🧾 <b>${isEn ? 'Rental Ref:' : 'Ref ค่าเช่า:'}</b> <code style="background:#E0F2FE; color:#0369A1; padding:2px 7px; border-radius:4px; font-weight:700; font-size:12px;">${b.rental_ref}</code></span>`);
    }
    if (hasRentSlip) {
      slipBadges.push(`<span>📎 <b>${isEn ? 'Rental Slip:' : 'สลิปค่าเช่า:'}</b> <a href="javascript:void(0)" onclick="app.viewSlip('${rentSlip}', '${isEn ? 'Rental Slip' : 'สลิปชำระคงเหลือ'} (${b.booking_id})')" style="color:#059669; font-weight:700; text-decoration:underline; cursor:pointer;">🖼️ ${isEn ? 'Click to view slip' : 'ดูสลิปชำระคงเหลือ'}</a></span>`);
    }

    summary.innerHTML = `
      <div class="deposit-summary-rows">
        <div class="deposit-summary-row"><span>${isEn ? 'ID' : 'รหัส'}</span><b>${b.booking_id}</b><span>${b.car_id || ''}</span></div>
        <div class="deposit-summary-row"><span>${isEn ? 'Customer' : 'ลูกค้า'}</span><b>${b.customer || '-'}</b><span>${b.customer_phone || ''}</span></div>
        <div class="deposit-summary-row"><span>${isEn ? 'Dates' : 'ระยะเวลา'}</span><b>${b.start_date_formatted || b.start_date || '-'} – ${b.end_date_formatted || b.end_date || '-'}</b></div>
        ${feesTotal > 0 ? `<div class="deposit-summary-row"><span>🚚 ${isEn ? 'Delivery/Pickup Fee' : 'ค่ารับ-ส่งนอกสถานที่'}</span><b style="color:#D97706;">฿${feesTotal.toLocaleString()}</b><span>${delFee > 0 ? `ส่ง ฿${delFee.toLocaleString()}` : ''}${delFee > 0 && picFee > 0 ? ' / ' : ''}${picFee > 0 ? `รับคืน ฿${picFee.toLocaleString()}` : ''}</span></div>` : ''}
        <div class="deposit-summary-row"><span>${isEn ? 'Net' : 'ค่าเช่าสุทธิ'}</span><b class="deposit-summary-price">฿${netP.toLocaleString()}</b><span style="color:${isDep ? '#059669' : '#DC2626'};">${isDep ? (isEn ? 'Deposit paid' : 'มัดจำชำระแล้ว') : (isEn ? 'Deposit pending' : 'รอมัดจำ')}</span></div>
        ${b.payment_type ? `<div class="deposit-summary-row"><span>${isEn ? 'Type' : 'ประเภท'}</span><b>${b.payment_type}</b></div>` : ''}
        ${b.google_drive_link ? `<a class="deposit-summary-slip" href="${b.google_drive_link}" target="_blank">${isEn ? 'Google Drive' : 'Google Drive'}</a>` : ''}
        ${b.deposit_slip ? `<a class="deposit-summary-slip" href="javascript:void(0)" onclick="app.viewSlip('${b.deposit_slip}', 'สลิปมัดจำ (${b.booking_id})')">${isEn ? 'View slip' : 'ดูสลิปมัดจำ'}</a>` : ''}
        ${(b.rental_slip && b.rental_slip !== b.deposit_slip) ? `<a class="deposit-summary-slip" href="javascript:void(0)" onclick="app.viewSlip('${b.rental_slip}', 'สลิปชำระคงเหลือ (${b.booking_id})')">${isEn ? 'View rental slip' : 'ดูสลิปคงเหลือ'}</a>` : ''}
        ${slipBadges.length > 0 ? `<div class="deposit-summary-extra">${slipBadges.join("")}</div>` : ''}
      </div>
    `;

    if (btnSaveSlip) btnSaveSlip.style.display = isDep ? "inline-flex" : "none";
    if (btnSettle) { 
      const remVal = this.computeBookingRemainingBalance(b);
      btnSettle.style.display = ((!isRent && isDep) || remVal > 0) ? "inline-flex" : "none"; 
    }
    if (btnDlDep) btnDlDep.style.display = isDep ? "inline-flex" : "none";
    if (btnDlRent) btnDlRent.style.display = isRent ? "inline-flex" : "none";
    if (btnDlContract) btnDlContract.style.display = "inline-flex";
  },

  async onDepositSlipSelected(input) {
    if (!input.files || input.files.length === 0) return;
    const file = input.files[0];
    const formData = new FormData();
    formData.append("file", file);

    const statusEl = document.getElementById("deposit-slip-status");
    if (statusEl) statusEl.innerHTML = `<span style="color:#2563EB;">⏳ กำลังอัปโหลด...</span>`;

    try {
      this.showToast(`⏳ กำลังอัปโหลดสลิป ${file.name}...`, "info");
      const bkId = this.currentSelectedBooking?.booking_id || "";
      const uploadUrl = `/api/upload-photo?category=slip&ref_id=${encodeURIComponent(bkId || 'DEP')}`;
      const res = await fetch(uploadUrl, { method: "POST", body: formData });
      const data = await res.json();
      if (!data.success || !data.url) {
        throw new Error(data.detail || "อัปโหลดรูปภาพสลิปไม่สำเร็จ");
      }

      const slipUrl = data.url;
      const urlInput = document.getElementById("deposit-slip-url");
      if (urlInput) urlInput.value = slipUrl;

      this.showDepositSlipPreview(slipUrl, file.name);
      this.showToast(`✅ อัปโหลดรูปสลิปเรียบร้อย!`, "success");
    } catch (err) {
      console.error("Upload slip error:", err);
      if (statusEl) statusEl.innerHTML = `<span style="color:#DC2626;">❌ อัปโหลดไม่สำเร็จ</span>`;
      this.showToast("อัปโหลดสลิปไม่สำเร็จ: " + err.message, "danger");
    }
  },

  showDepositSlipPreview(url, fileName = "สลิปหลักฐานการชำระเงิน") {
    const box = document.getElementById("deposit-slip-preview-box");
    const img = document.getElementById("deposit-slip-preview-img");
    const nameEl = document.getElementById("deposit-slip-preview-name");
    const statusEl = document.getElementById("deposit-slip-status");

    this.currentDepositSlipUrl = url;
    this.currentDepositSlipName = fileName;

    if (box && img) {
      box.style.display = "flex";
      img.src = this.convertDriveUrl(url) || url;
      if (nameEl) nameEl.textContent = fileName || "สลิปหลักฐานการชำระเงิน";
      if (statusEl) statusEl.innerHTML = `<b style="color:#059669;">✔️ แนบสลิปแล้ว</b>`;
    }
  },

  viewCurrentDepositSlip() {
    if (!this.currentDepositSlipUrl) {
      this.showToast("⚠️ ยังไม่มีรูปภาพสลิปให้แสดง", "danger");
      return;
    }
    this.viewSlip(this.currentDepositSlipUrl, this.currentDepositSlipName || "สลิปมัดจำ");
  },

  viewCurrentRentalSlip() {
    if (!this.currentRentalSlipUrl) {
      this.showToast("⚠️ ยังไม่มีรูปภาพสลิปชำระคงเหลือ", "danger");
      return;
    }
    this.viewSlip(this.currentRentalSlipUrl, "สลิปชำระค่าเช่าคงเหลือ");
  },

  clearDepositSlip(resetFile = true) {
    const urlInput = document.getElementById("deposit-slip-url");
    if (urlInput) urlInput.value = "";
    this.currentDepositSlipUrl = null;
    this.currentDepositSlipName = null;
    const box = document.getElementById("deposit-slip-preview-box");
    if (box) box.style.display = "none";
    const rentBox = document.getElementById("rental-slip-preview-box");
    if (rentBox) rentBox.style.display = "none";
    this.currentRentalSlipUrl = null;
    const statusEl = document.getElementById("deposit-slip-status");
    if (statusEl) statusEl.textContent = "ยังไม่ได้แนบสลิป";
    if (resetFile) {
      const fileInput = document.getElementById("deposit-slip-file");
      if (fileInput) fileInput.value = "";
    }
  },

  viewSlip(url, title = "สลิปหลักฐานการชำระเงิน") {
    if (!url || url === "-" || url === "null" || url === "undefined") {
      this.showToast("⚠️ ไม่พบรูปภาพสลิป หรือยังไม่ได้แนบสลิป", "danger");
      return;
    }

    this.currentViewingSlip = { url, title };
    const titleEl = document.getElementById("modal-slip-title-text");
    const imgEl = document.getElementById("modal-slip-viewer-img");
    const emptyEl = document.getElementById("modal-slip-viewer-empty");
    const urlPrevEl = document.getElementById("modal-slip-url-preview");

    if (titleEl) titleEl.textContent = title;
    if (urlPrevEl) {
      urlPrevEl.textContent = url.startsWith("data:") ? "สลิป (รูปภาพ Base64)" : url;
      urlPrevEl.title = url;
    }

    const directSrc = this.convertDriveUrl(url) || url;
    const isPdf = String(url).toLowerCase().includes(".pdf");

    if (isPdf) {
      if (imgEl) imgEl.style.display = "none";
      if (emptyEl) {
        emptyEl.style.display = "block";
        emptyEl.innerHTML = `
          <div style="font-size:36px; margin-bottom:10px;">📄</div>
          <div style="font-weight:700; color:#FFFFFF;">เอกสารสลิปในรูปแบบ PDF</div>
          <div style="font-size:12px; margin-top:6px; color:#94A3B8;">กรุณากดปุ่ม "เปิดในแท็บใหม่" หรือ "ดาวน์โหลดสลิป" เพื่อดูเอกสาร</div>
        `;
      }
    } else {
      if (emptyEl) emptyEl.style.display = "none";
      if (imgEl) {
        imgEl.style.display = "block";
        imgEl.src = directSrc;
        imgEl.onerror = () => {
          imgEl.style.display = "none";
          if (emptyEl) {
            emptyEl.style.display = "block";
            emptyEl.innerHTML = `
              <div style="font-size:36px; margin-bottom:10px;">🖼️</div>
              <div style="font-weight:700; color:#FFFFFF;">ไม่สามารถแสดงภาพตัวอย่างได้โดยตรง</div>
              <div style="font-size:12px; margin-top:6px; color:#94A3B8;">กรุณากดปุ่มเปิดดูในแท็บใหม่ หรือเปิดใน Google Drive</div>
            `;
          }
        };
      }
    }

    this.openModal("modal-slip-viewer");
  },

  openSafeImageWindow(url) {
    if (!url) return;
    if (url.startsWith("data:")) {
      try {
        // Convert Base64 data URL to native Blob URL to safely bypass Chrome's top-frame navigation block
        const parts = url.split(";base64,");
        const contentType = parts[0].replace("data:", "") || "image/jpeg";
        const byteCharacters = atob(parts[1]);
        const byteArrays = [];
        for (let offset = 0; offset < byteCharacters.length; offset += 512) {
          const slice = byteCharacters.slice(offset, offset + 512);
          const byteNumbers = new Array(slice.length);
          for (let i = 0; i < slice.length; i++) {
            byteNumbers[i] = slice.charCodeAt(i);
          }
          byteArrays.push(new Uint8Array(byteNumbers));
        }
        const blob = new Blob(byteArrays, { type: contentType });
        const blobUrl = URL.createObjectURL(blob);
        window.open(blobUrl, "_blank");
      } catch (e) {
        console.error("Blob URL creation error:", e);
        const win = window.open("", "_blank");
        if (win) {
          win.document.write(`<html><head><title>สลิปการชำระเงิน</title></head><body style="margin:0;background:#0f172a;display:flex;align-items:center;justify-content:center;height:100vh;"><img src="${url}" style="max-width:98%;max-height:98vh;object-fit:contain;border-radius:8px;"/></body></html>`);
          win.document.close();
        }
      }
    } else {
      window.open(url, "_blank");
    }
  },

  openCurrentSlipExternal() {
    if (!this.currentViewingSlip?.url) return;
    this.openSafeImageWindow(this.currentViewingSlip.url);
  },

  downloadCurrentSlip() {
    if (!this.currentViewingSlip?.url) return;
    const url = this.currentViewingSlip.url;
    const cleanTitle = (this.currentViewingSlip.title || "slip").replace(/[\s\/:*?"<>|]/g, "_");
    const filename = `${cleanTitle}.jpg`;

    if (url.startsWith("data:")) {
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } else {
      window.open(url, "_blank");
    }
  },

  async submitDeposit() {
    if (!this.currentSelectedBooking) return;
    const bkId = this.currentSelectedBooking.booking_id;
    const depAmt = parseFloat(document.getElementById("deposit-amount-input").value) || 0;
    const depMethod = document.getElementById("deposit-method-input").value;
    const depRef = (document.getElementById("deposit-ref-input")?.value || "").trim();
    const slipUrl = (document.getElementById("deposit-slip-url")?.value || "").trim();
    const gdriveLink = (document.getElementById("deposit-gdrive-input")?.value || "").trim();
    const alsoRent = Boolean(document.getElementById("deposit-also-rent")?.checked);
    const payType = alsoRent ? "มัดจำและค่าเช่า" : "มัดจำประกันสัญญา";

    try {
      this.showToast(`⏳ กำลังบันทึกรับเงินมัดจำ ${bkId}...`, "info");
      const res = await fetch(`/api/bookings/${bkId}/deposit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          booking_id: bkId,
          amount: depAmt,
          payment_method: depMethod,
          ref_id: depRef,
          slip_image_url: slipUrl || gdriveLink,
          deposit_amount: depAmt,
          payment_ref: depRef,
          deposit_ref: depRef,
          slip_url: slipUrl,
          payment_type: payType,
          google_drive_link: gdriveLink,
          also_pay_rental: alsoRent
        })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        this.showToast("บันทึกข้อมูลการเงินสำเร็จ", "success");
        if (typeof Swal !== "undefined") {
          Swal.fire({
            icon: 'success',
            title: 'บันทึกข้อมูลการเงินสำเร็จ',
            text: `บันทึกเงินมัดจำสำหรับใบจอง ${bkId} เรียบร้อยแล้ว`,
            timer: 2000,
            showConfirmButton: false
          });
        }
        await this.loadBookings();
        await this.loadCars();
        if (typeof this.loadDashboardKPIs === "function") {
          await this.loadDashboardKPIs();
        }
        this.onSelectDepositBooking();
        await this.goToTabWithBooking("assign", bkId);
      } else {
        throw new Error(data.detail || "บันทึกไม่สำเร็จ");
      }
    } catch (e) {
      console.error("[Deposit] Error submitting deposit:", e);
      this.showToast("เกิดข้อผิดพลาด: " + (e.message || "ไม่สามารถบันทึกข้อมูลการเงินได้"), "danger");
      if (typeof Swal !== "undefined") {
        Swal.fire({
          icon: 'error',
          title: 'เกิดข้อผิดพลาด',
          text: e.message || 'ไม่สามารถบันทึกข้อมูลการเงินได้'
        });
      }
    }
  },

  async submitSettle() {
    if (!this.currentSelectedBooking) return;
    const bkId = this.currentSelectedBooking.booking_id;
    const depMethod = document.getElementById("deposit-method-input").value;
    const depRef = (document.getElementById("deposit-ref-input")?.value || "").trim();
    const slipUrl = (document.getElementById("deposit-slip-url")?.value || "").trim();
    const gdriveLink = (document.getElementById("deposit-gdrive-input")?.value || "").trim();
    const rentAmt = parseFloat(this.currentSelectedBooking?.remaining_rental || this.currentSelectedBooking?.net_price || 0);

    try {
      this.showToast(`⏳ กำลังบันทึกชำระค่าเช่าคงเหลือ ${bkId}...`, "info");
      const res = await fetch(`/api/bookings/${bkId}/settle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          booking_id: bkId,
          amount: rentAmt,
          payment_method: depMethod,
          ref_id: depRef,
          slip_image_url: slipUrl || gdriveLink,
          payment_ref: depRef,
          rental_ref: depRef,
          slip_url: slipUrl || gdriveLink,
          rental_slip: slipUrl || gdriveLink,
          remaining_slip_link: slipUrl || gdriveLink
        })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        this.showToast("บันทึกข้อมูลการเงินสำเร็จ", "success");
        if (typeof Swal !== "undefined") {
          Swal.fire({
            icon: 'success',
            title: 'บันทึกข้อมูลการเงินสำเร็จ',
            text: `บันทึกชำระค่าเช่าสำหรับใบจอง ${bkId} เรียบร้อยแล้ว`,
            timer: 2000,
            showConfirmButton: false
          });
        }
        await this.loadBookings();
        this.onSelectDepositBooking();
      } else {
        throw new Error(data.detail || "บันทึกไม่สำเร็จ");
      }
    } catch (e) {
      console.error("[Settle] Error submitting settle:", e);
      this.showToast("เกิดข้อผิดพลาด: " + (e.message || "ไม่สามารถบันทึกข้อมูลการเงินได้"), "danger");
      if (typeof Swal !== "undefined") {
        Swal.fire({
          icon: 'error',
          title: 'เกิดข้อผิดพลาด',
          text: e.message || 'ไม่สามารถบันทึกข้อมูลการเงินได้'
        });
      }
    }
  },

  async submitUpdateSlipOnly() {
    if (!this.currentSelectedBooking) return;
    const bkId = this.currentSelectedBooking.booking_id;
    const depRef = (document.getElementById("deposit-ref-input")?.value || "").trim();
    const slipUrl = (document.getElementById("deposit-slip-url")?.value || "").trim();
    const alsoRent = Boolean(document.getElementById("deposit-also-rent")?.checked);
    const payType = alsoRent ? "มัดจำและค่าเช่า" : (this.currentSelectedBooking?.payment_type || "มัดจำประกันสัญญา");
    const gdriveLink = (document.getElementById("deposit-gdrive-input")?.value || "").trim();

    try {
      this.showToast(`⏳ กำลังอัปเดตสลิปและเลข Ref สำหรับ ${bkId}...`, "info");
      const res = await fetch(`/api/bookings/${bkId}/payment-slip`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          payment_ref: depRef,
          slip_url: slipUrl,
          payment_type: payType,
          google_drive_link: gdriveLink
        })
      });
      const data = await res.json();
      if (data.success) {
        this.showToast(`✅ อัปเดตสลิปและเลข Ref ${bkId} เรียบร้อย!`, "success");
        await this.loadBookings();
        this.onSelectDepositBooking();
      } else {
        throw new Error(data.detail || "อัปเดตไม่สำเร็จ");
      }
    } catch (e) {
      this.showToast("เกิดข้อผิดพลาด: " + e.message, "danger");
    }
  },

  populateStaffDropdowns() {
    const dispW = document.getElementById("assign-disp-worker");
    const retW = document.getElementById("assign-ret-worker");
    const walkinW = document.getElementById("walkin-worker-select");
    const approved = (this.users || []).filter(u => !u.status || u.status === "approved");
    const opts = approved.map(u => {
      const uname = u.username;
      const label = (u.name && u.name !== uname) ? `${uname} (${u.name})` : uname;
      return `<option value="${uname}">${label} [${u.role || 'Staff'}]</option>`;
    }).join("");
    const fallback = `<option value="admin">admin (ผู้ดูแลระบบ) [Admin]</option>`;

    [dispW, retW, walkinW].forEach(sel => {
      if (!sel) return;
      const cur = sel.value;
      sel.innerHTML = opts || fallback;
      if (cur && cur !== "Wait" && cur !== "-" && Array.from(sel.options).some(o => o.value === cur)) {
        sel.value = cur;
      } else if (sel.options.length > 0) {
        sel.selectedIndex = 0;
      }
    });
  },

  setAssignMode(mode) {
    const isDisp = mode !== "Return";
    this.assignMode = isDisp ? "Dispatch" : "Return";
    const dispCard = document.getElementById("assign-card-disp");
    const retCard = document.getElementById("assign-card-ret");
    if (dispCard) dispCard.style.display = isDisp ? "block" : "none";
    if (retCard) retCard.style.display = isDisp ? "none" : "block";
    document.querySelectorAll('input[name="assign-mode"]').forEach(r => { r.checked = (r.value === this.assignMode); });
    const dispSel = document.getElementById("assign-disp-bk");
    const retSel = document.getElementById("assign-ret-bk");
    if (isDisp && dispSel && retSel && retSel.value && dispSel.value !== retSel.value) {
      dispSel.value = retSel.value;
      this.onSelectAssignDispBooking();
    } else if (!isDisp && dispSel && retSel && dispSel.value && retSel.value !== dispSel.value) {
      retSel.value = dispSel.value;
      this.onSelectAssignRetBooking();
    }
  },

  async goToTabWithBooking(tabName, bkId) {
    if (bkId) {
      const b = this.bookings.find(x => x.booking_id === bkId);
      if (b) this.currentSelectedBooking = b;
    }
    await this.switchTab(tabName);
    if (!bkId) return;
    if (tabName === "deposit") {
      const sel = document.getElementById("deposit-sel-booking");
      if (sel) {
        sel.value = bkId;
        this.onSelectDepositBooking();
      }
    } else if (tabName === "assign") {
      this.confirmedAssignSides = this.confirmedAssignSides || {};
      this.confirmedAssignSides[bkId] = { Dispatch: false, Return: false };
      const sel = document.getElementById("assign-disp-bk");
      if (sel) {
        sel.value = bkId;
        this.onSelectAssignDispBooking();
      }
      const retSel = document.getElementById("assign-ret-bk");
      if (retSel) {
        retSel.value = bkId;
        this.onSelectAssignRetBooking();
      }
      const bkObj = this.bookings.find(x => x.booking_id === bkId);
      this.setAssignMode(bkObj && ["กำลังเช่า", "เตรียมรับคืน"].includes(bkObj.status) ? "Return" : "Dispatch");
    } else if (tabName === "contract") {
      const sel = document.getElementById("contract-sel-bk");
      if (sel) {
        sel.value = bkId;
        this.onSelectContractBooking();
      }
    }
  },

  onSelectAssignDispBooking() {
    const isEn = (this.currentLang === "EN");
    const bkId = document.getElementById("assign-disp-bk")?.value;
    const form = document.getElementById("assign-disp-form");
    if (!bkId) {
      if (form) form.style.display = "none";
      return;
    }
    if (form) form.style.display = "block";
    this.populateStaffDropdowns();

    // Auto-sync right-side Return Work Order dropdown to the same booking
    const retSel = document.getElementById("assign-ret-bk");
    if (retSel && retSel.value !== bkId) {
      retSel.value = bkId;
      this.onSelectAssignRetBooking();
    }

    const b = this.bookings.find(x => x.booking_id === bkId);
    if (b) {
      const dispPrintBtn = document.getElementById("btn-assign-disp-print-pdf");
      if (dispPrintBtn) {
        dispPrintBtn.href = b.checkout_pdf_url || `/api/pdf/inspection/${bkId}?type=checkout`;
        dispPrintBtn.style.display = "block";
        dispPrintBtn.onclick = (e) => {
          e.preventDefault();
          this.printInspectionForm('Dispatch');
        };
      }
      const sDateEl = document.getElementById("assign-disp-start-date");
      const eDateEl = document.getElementById("assign-disp-end-date");
      const dispDateEl = document.getElementById("assign-disp-date");
      const locEl = document.getElementById("assign-disp-loc");
      const timeEl = document.getElementById("assign-disp-time");
      const workerEl = document.getElementById("assign-disp-worker");
      const bannerEl = document.getElementById("assign-disp-status-banner");

      const thNow = this.getThaiDateTime(0);
      const sVal = b.start_date || thNow.date;
      const eVal = b.end_date || thNow.date;
      if (sDateEl) sDateEl.value = sVal;
      if (eDateEl) eDateEl.value = eVal;
      if (dispDateEl) dispDateEl.value = sVal;
      if (locEl) locEl.value = b.loc_delivery || "";
      if (timeEl) timeEl.value = b.start_time || thNow.time;
      if (workerEl) {
        const w = String(b.worker_delivery || "").trim();
        if (w && w !== "Wait" && w !== "-" && Array.from(workerEl.options).some(o => o.value === w)) {
          workerEl.value = w;
        } else if (workerEl.options.length > 0) {
          workerEl.selectedIndex = 0;
        }
      }

      const odoEl = document.getElementById("assign-disp-odometer");
      const fuelEl = document.getElementById("assign-disp-fuel");
      const notesEl = document.getElementById("assign-disp-notes");
      const photosUrlEl = document.getElementById("assign-disp-photos-url");
      const photosPrevEl = document.getElementById("assign-disp-photos-preview");

      if (odoEl) odoEl.value = b.odometer_out || b.dispatch_mileage || "";
      const savedDispCats = b.inspection_categories_out || b.inspection_categories;
      ['petrol', 'cleanliness', 'tires', 'interior', 'underhood'].forEach(k => {
        const el = document.getElementById("assign-disp-chk-" + k);
        if (el) el.checked = savedDispCats ? (savedDispCats[k] !== false) : true;
      });
      if (fuelEl) fuelEl.value = b.fuel_out || b.dispatch_fuel || fuelEl.value;
      if (notesEl) notesEl.value = b.inspection_notes_out || b.dispatch_notes || b.remarks || "";
      if (photosUrlEl) photosUrlEl.value = b.inspection_photos_out || "";
      this.assignDispPhotos = b.inspection_photos_out ? b.inspection_photos_out.split(",").map(x => x.trim()).filter(Boolean) : [];
      this.renderInspectionPhotosPreview("Dispatch", this.assignDispPhotos);

      if (bannerEl) {
        const isDep = Boolean(b.deposit_paid);
        const isRent = Boolean(b.rental_paid);
        const netP = parseFloat(b.net_price || 0);
        const depAmt = parseFloat(b.deposit_amount || 5000);
        const remP = this.computeBookingRemainingBalance(b);
        const wDel = String(b.worker_delivery || "").trim();
        const hasDriver = wDel && wDel !== "Wait" && wDel !== "-";
        const sFmt = b.start_date_formatted || sVal;
        const eFmt = b.end_date_formatted || eVal;
        const delFee = parseFloat(b.delivery_fee || 0);
        const isDelOffsite = String(b.delivery_mode || "").toLowerCase() === "offsite" || delFee > 0;
        const offsiteDispHtml = isDelOffsite
          ? `<div style="background:#FFF7ED; border:1.5px solid #FDBA74; border-radius:8px; padding:8px 12px; margin-bottom:8px; font-size:12.5px; color:#9A3412;">
               🚚 <b>${isEn ? 'Off-site Vehicle Delivery:' : 'งานจัดส่งรถนอกสถานที่:'}</b> 📍 <b>${b.loc_delivery || '-'}</b>
               ${delFee > 0 ? `<span style="background:#EA580C; color:#FFF; padding:1px 8px; border-radius:999px; font-size:11.5px; font-weight:700; margin-left:6px;">ค่าส่ง ฿${delFee.toLocaleString()} (${isRent ? 'ชำระแล้ว' : 'รวมในบิล'})</span>` : ''}
             </div>`
          : '';

        let html = `
          <div style="background:#FAF7F2; border:1px solid #E5E7EB; border-radius:8px; padding:8px 12px; margin-bottom:8px; font-size:12.5px; color:#1F2937;">
            📅 <b>${isEn ? 'Pick-up Schedule:' : 'กำหนดส่งมอบรถ:'}</b> <span style="color:#EA580C; font-weight:700;">${sFmt} (${b.start_time || '10:00'}${isEn ? '' : ' น.'})</span> &nbsp;|&nbsp; <b>${isEn ? 'Return Schedule:' : 'กำหนดคืนรถ:'}</b> <span style="font-weight:700;">${eFmt} (${b.end_time || '10:00'}${isEn ? '' : ' น.'})</span>
          </div>
          ${offsiteDispHtml}
        `;
        if (!isDep) {
          html += `
            <div style="background:#FFFBEB; border:1px solid #F59E0B; border-radius:8px; padding:10px 12px; margin-bottom:8px; display:flex; justify-content:space-between; align-items:center; gap:8px; flex-wrap:wrap;">
              <div style="font-size:12.5px; color:#92400E;"><b>🟡 ${isEn ? 'Booking Status: Awaiting Deposit' : 'สถานะการจอง: รอชำระเงินมัดจำ'}</b> (${isEn ? 'Driver can be assigned in advance' : 'สามารถมอบหมายคนขับล่วงหน้าได้'})</div>
              <button type="button" onclick="app.goToTabWithBooking('deposit', '${b.booking_id}')" class="btn btn-secondary" style="padding:4px 10px; font-size:12px; font-weight:700;">💳 ${isEn ? 'Collect Deposit' : 'ไปรับมัดจำ'}</button>
            </div>
          `;
        }
        if (isRent) {
          html += `
            <div style="background:#ECFDF5; border:1px solid #10B981; border-radius:8px; padding:8px 12px; margin-bottom:8px; font-size:12.5px; color:#065F46; font-weight:700;">
              ✅ ${isEn ? 'Rental fee fully paid' : 'ชำระค่าเช่ารถครบถ้วนแล้ว'} (฿${netP.toLocaleString('th-TH', {minimumFractionDigits: 2})})
            </div>
          `;
          if (b.contract_issued) {
            html += `
              <div style="background:#F0FDF4; border:1px solid #86EFAC; border-radius:8px; padding:8px 12px; margin-bottom:8px; font-size:12.5px; color:#166534; font-weight:700;">
                ✅ ${isEn ? 'Rental contract issued (Ready for vehicle delivery)' : 'ออกสัญญาเช่าเรียบร้อยแล้ว (พร้อมส่งมอบรถยนต์)'}
              </div>
            `;
          } else {
            html += `
              <div style="background:#EFF6FF; border:1px solid #BFDBFE; border-radius:8px; padding:8px 12px; margin-bottom:8px; display:flex; justify-content:space-between; align-items:center; gap:8px; flex-wrap:wrap;">
                <div style="font-size:12.5px; color:#1E40AF;">📝 <b>${isEn ? 'Awaiting Contract:' : 'รอออกสัญญาเช่า:'}</b> ${isEn ? 'Please issue contract in Tab 4 before vehicle handover' : 'กรุณาไปออกสัญญาเช่าในแท็บ 4 ก่อนส่งมอบรถยนต์'}</div>
                <button type="button" onclick="app.goToTabWithBooking('contract', '${b.booking_id}')" class="btn btn-primary btn-sm" style="padding:4px 10px; font-size:11.5px; font-weight:700;">📝 ${isEn ? 'Go to Contract' : 'ไปหน้าสัญญา ➔'}</button>
              </div>
            `;
          }
        } else {
          html += `
            <div style="background:#EFF6FF; border:1px solid #93C5FD; border-radius:8px; padding:8px 12px; margin-bottom:8px; display:flex; justify-content:space-between; align-items:center; gap:8px; flex-wrap:wrap;">
              <div style="font-size:12.5px; color:#1E40AF;">⏳ <b>${isEn ? 'Pending Rental Fee on Pick-up:' : 'รอชำระค่าเช่าวันรับรถ:'}</b> ฿${remP.toLocaleString('th-TH', {minimumFractionDigits: 2})}</div>
              <button type="button" onclick="app.openSettleModal('${b.booking_id}')" class="btn btn-secondary" style="padding:4px 10px; font-size:12px; font-weight:700;">💳 ${isEn ? 'Pay Rental Fee' : 'กดจ่ายเงินค่าเช่า'}</button>
            </div>
          `;
        }
        if (hasDriver) {
          html += `
            <div style="background:#F0FDF4; border:1px solid #86EFAC; border-radius:8px; padding:8px 12px; font-size:12.5px; color:#166534;">
              🚚 <b>${isEn ? 'Dispatch Staff Assigned:' : 'มอบหมายพนักงานจัดส่งแล้ว:'}</b> ${wDel} (${isEn ? 'Date' : 'วันที่'} ${sFmt} ${isEn ? 'Time' : 'เวลา'} ${b.start_time || '10:00'}${isEn ? '' : ' น.'})
            </div>
          `;
        }
        bannerEl.innerHTML = html;
      }
    }
  },

  onSelectAssignRetBooking() {
    const isEn = (this.currentLang === "EN");
    const bkId = document.getElementById("assign-ret-bk")?.value;
    const form = document.getElementById("assign-ret-form");
    if (!bkId) {
      if (form) form.style.display = "none";
      return;
    }
    if (form) form.style.display = "block";
    this.populateStaffDropdowns();
    const dispSel = document.getElementById("assign-disp-bk");
    if (dispSel && dispSel.value !== bkId) {
      dispSel.value = bkId;
    }
    const b = this.bookings.find(x => x.booking_id === bkId);
    if (b) {
      const retPrintBtn = document.getElementById("btn-assign-ret-print-pdf");
      if (retPrintBtn) {
        retPrintBtn.href = b.checkin_pdf_url || `/api/pdf/inspection/${bkId}?type=checkin`;
        retPrintBtn.style.display = "block";
        retPrintBtn.onclick = (e) => {
          e.preventDefault();
          this.printInspectionForm('Return');
        };
      }
      const sDateEl = document.getElementById("assign-ret-start-date");
      const eDateEl = document.getElementById("assign-ret-end-date");
      const retDateEl = document.getElementById("assign-ret-date");
      const locEl = document.getElementById("assign-ret-loc");
      const timeEl = document.getElementById("assign-ret-time");
      const workerEl = document.getElementById("assign-ret-worker");
      const bannerEl = document.getElementById("assign-ret-status-banner");

      const thNow = this.getThaiDateTime(0);
      const sVal = b.start_date || thNow.date;
      const eVal = b.end_date || thNow.date;
      if (sDateEl) sDateEl.value = sVal;
      if (eDateEl) eDateEl.value = eVal;
      if (retDateEl) retDateEl.value = eVal;
      if (locEl) locEl.value = b.loc_return || b.loc_delivery || "";
      if (timeEl) timeEl.value = b.end_time || thNow.time;
      if (workerEl) {
        const w = String(b.worker_return || "").trim();
        if (w && w !== "Wait" && w !== "-" && Array.from(workerEl.options).some(o => o.value === w)) {
          workerEl.value = w;
        } else if (workerEl.options.length > 0) {
          workerEl.selectedIndex = 0;
        }
      }

      const odoEl = document.getElementById("assign-ret-odometer");
      const fuelEl = document.getElementById("assign-ret-fuel");
      const notesEl = document.getElementById("assign-ret-notes");
      const photosUrlEl = document.getElementById("assign-ret-photos-url");
      const photosPrevEl = document.getElementById("assign-ret-photos-preview");
      const badgeEl = document.getElementById("assign-ret-compare-badge");

      const imgFEl = document.getElementById("assign-ret-img-front");
      const imgLEl = document.getElementById("assign-ret-img-left");
      const imgReEl = document.getElementById("assign-ret-img-rear");
      const imgRiEl = document.getElementById("assign-ret-img-right");
      if (imgFEl) imgFEl.value = b.checkin_img_front || "";
      if (imgLEl) imgLEl.value = b.checkin_img_left || "";
      if (imgReEl) imgReEl.value = b.checkin_img_rear || "";
      if (imgRiEl) imgRiEl.value = b.checkin_img_right || "";

      if (odoEl) odoEl.value = b.odometer_in || b.return_mileage || "";
      const savedRetCats = b.inspection_categories_in || b.inspection_categories;
      ['petrol', 'cleanliness', 'tires', 'interior', 'underhood'].forEach(k => {
        const el = document.getElementById("assign-ret-chk-" + k);
        if (el) el.checked = savedRetCats ? (savedRetCats[k] !== false) : true;
      });
      if (fuelEl) fuelEl.value = b.fuel_in || b.return_fuel || fuelEl.value;
      if (notesEl) notesEl.value = b.inspection_notes_in || b.return_notes || b.remarks || "";
      if (photosUrlEl) photosUrlEl.value = b.inspection_photos_in || "";
      this.assignRetPhotos = b.inspection_photos_in ? b.inspection_photos_in.split(",").map(x => x.trim()).filter(Boolean) : [];
      this.renderInspectionPhotosPreview("Return", this.assignRetPhotos);

      if (badgeEl) {
        const outOdoFmt = b.odometer_out ? `${Number(b.odometer_out).toLocaleString()} กม.` : 'ไม่ได้ระบุ';
        const outFuelFmt = b.fuel_out || 'ไม่ได้ระบุ';
        const outNotesFmt = b.inspection_notes_out ? `"${b.inspection_notes_out}"` : 'ไม่มีบันทึก';
        const picFee = parseFloat(b.pickup_fee || 0);
        const isPicOffsite = String(b.pickup_mode || "").toLowerCase() === "offsite" || picFee > 0;
        const offsiteRetNote = isPicOffsite
          ? `<div style="margin-top:4px; color:#0F766E; font-weight:700;">🚚 รับรถคืนนอกสถานที่ @ ${b.loc_return || b.loc_delivery || '-'}${picFee > 0 ? ` (ค่ารับคืน ฿${picFee.toLocaleString()})` : ''}</div>`
          : '';
        badgeEl.innerHTML = `📌 <b>ข้อมูลตอนส่งมอบ (Outbound):</b> เลขไมล์: <span style="font-weight:700; color:#B45309;">${outOdoFmt}</span> | ระดับน้ำมัน: <span style="font-weight:700; color:#B45309;">${outFuelFmt}</span> | ตำหนิเดิม: <span style="font-style:italic;">${outNotesFmt}</span>${offsiteRetNote}`;
      }
      this.recalcReturnInspectionDiff();

      if (bannerEl) {
        const wRet = String(b.worker_return || "").trim();
        const hasDriver = wRet && wRet !== "Wait" && wRet !== "-";
        const sFmt = b.start_date_formatted || sVal;
        const eFmt = b.end_date_formatted || eVal;
        let html = `
          <div style="background:#FAF7F2; border:1px solid #E5E7EB; border-radius:8px; padding:8px 12px; margin-bottom:8px; font-size:12.5px; color:#1F2937;">
            📅 <b>${isEn ? 'Return Schedule:' : 'กำหนดรับรถคืน:'}</b> <span style="color:#EA580C; font-weight:700;">${eFmt} (${b.end_time || '10:00'}${isEn ? '' : ' น.'})</span> &nbsp;|&nbsp; <b>${isEn ? 'Rental Start:' : 'วันเริ่มเช่า:'}</b> <span>${sFmt}</span>
          </div>
        `;
        if (hasDriver) {
          html += `
            <div style="background:#F0FDF4; border:1px solid #86EFAC; border-radius:8px; padding:8px 12px; font-size:12.5px; color:#166534;">
              🔙 <b>${isEn ? 'Return Staff Assigned:' : 'มอบหมายพนักงานรับรถคืนแล้ว:'}</b> ${wRet} (${isEn ? 'Date' : 'วันที่'} ${eFmt} ${isEn ? 'Time' : 'เวลา'} ${b.end_time || '10:00'}${isEn ? '' : ' น.'})
            </div>
          `;
        }
        bannerEl.innerHTML = html;
      }
    }
  },

  renderInspectionPhotosPreview(mode, photos = [], isUploading = false) {
    const isDisp = mode === "Dispatch";
    const prevEl = document.getElementById(isDisp ? "assign-disp-photos-preview" : "assign-ret-photos-preview");
    if (!prevEl) return;

    const angleDefs = [
      { key: "front", label: "1. ด้านหน้า (Front)", icon: "🚘" },
      { key: "left", label: "2. ด้านซ้าย (Left)", icon: "🚗" },
      { key: "rear", label: "3. ด้านหลัง (Rear)", icon: "🚙" },
      { key: "right", label: "4. ด้านขวา (Right)", icon: "🏎️" }
    ];

    prevEl.innerHTML = angleDefs.map((def, idx) => {
      const url = photos[idx];
      if (url) {
        const directSrc = this.convertDriveUrl ? this.convertDriveUrl(url) : url;
        return `
          <div style="position:relative; background:#0F172A; border-radius:8px; overflow:hidden; border:1.5px solid #EA580C; height:85px; display:flex; align-items:center; justify-content:center; box-shadow:0 2px 4px rgba(0,0,0,0.1);">
            <span style="position:absolute; top:3px; left:4px; background:rgba(15,23,42,0.88); color:#F8FAFC; font-size:9px; font-weight:700; padding:1px 5px; border-radius:3px; z-index:2; border:1px solid rgba(255,255,255,0.15);">
              ${def.label}
            </span>
            <img src="${directSrc}" onclick="window.open('${url || directSrc}', '_blank')" style="width:100%; height:100%; object-fit:cover; cursor:pointer;" title="คลิกดูรูปขนาดเต็มในแท็บใหม่">
            <span style="position:absolute; bottom:3px; right:4px; font-size:9px; color:#10B981; font-weight:700; background:rgba(15,23,42,0.85); padding:1px 5px; border-radius:3px; border:1px solid rgba(16,185,129,0.3);">
              ${isUploading ? '⏳ กำลังอัปโหลด...' : '✓ GDrive'}
            </span>
          </div>
        `;
      }
      return `
        <div style="border:1.5px dashed #CBD5E1; border-radius:8px; height:85px; display:flex; flex-direction:column; align-items:center; justify-content:center; background:#F8FAFC; color:#64748B; font-size:10px; font-weight:600; text-align:center; padding:4px;">
          <span style="font-size:16px; margin-bottom:2px;">${def.icon}</span>
          <span>${def.label}</span>
        </div>
      `;
    }).join("");
  },

  onInspectionPhotoUrlInput(mode, val) {
    const urls = String(val || "").split(",").map(x => x.trim()).filter(Boolean);
    if (mode === "Dispatch") this.assignDispPhotos = urls;
    else this.assignRetPhotos = urls;
    this.renderInspectionPhotosPreview(mode, urls, false);
  },

  async handleInspectionPhotoUpload(input, mode) {
    const isDisp = mode === "Dispatch";
    const fileInput = (input && input.files) ? input : document.getElementById(isDisp ? "assign-disp-photos-input" : "assign-ret-photos-input");
    if (!fileInput || !fileInput.files || fileInput.files.length === 0) return;
    const bkId = document.getElementById(isDisp ? "assign-disp-bk" : "assign-ret-bk")?.value;
    const bkObj = (this.bookings || []).find(x => x.booking_id === bkId);
    let carPlate = bkObj?.car_id || "";

    if (!carPlate && !bkId) {
      alert("⚠️ กรุณาเลือกรหัสการจองก่อนเลือกรูปถ่ายสภาพรถยนต์");
      fileInput.value = "";
      return;
    }
    if (!carPlate) {
      carPlate = "unknown";
    }

    const filesToUpload = Array.from(fileInput.files).slice(0, 4);
    if (filesToUpload.length === 0) return;

    // Instant local preview for immediate visual feedback
    const tempUrls = filesToUpload.map(f => URL.createObjectURL(f));
    this.renderInspectionPhotosPreview(mode, tempUrls, true);

    const formData = new FormData();
    formData.append("booking_id", bkId || "");
    formData.append("job_type", mode);
    const angleNames = ["front", "left", "rear", "right"];
    filesToUpload.forEach((f, idx) => {
      formData.append("files", f);
      formData.append("photos", f);
      if (angleNames[idx]) {
        formData.append(angleNames[idx], f);
      }
    });

    this.showToast(`📸 กำลังอัปโหลดรูปรถ 4 มุม (${filesToUpload.length} รูป) ขึ้น Google Drive...`, "info");
    try {
      const res = await fetch(`/api/cars/${encodeURIComponent(carPlate)}/4-angles`, {
        method: "POST",
        body: formData
      });
      const data = await res.json();
      if (res.ok && data.success) {
        const uploadedUrls = (data.urls || []).filter(Boolean);
        if (isDisp) this.assignDispPhotos = uploadedUrls;
        else this.assignRetPhotos = uploadedUrls;

        const urlInput = document.getElementById(isDisp ? "assign-disp-photos-url" : "assign-ret-photos-url");
        if (urlInput) urlInput.value = uploadedUrls.join(",");

        // Render permanent Google Drive links
        this.renderInspectionPhotosPreview(mode, uploadedUrls, false);

        // Update frontend car data immediately for Fleet & Car details modal
        if (this.cars && this.cars[carPlate]) {
          Object.assign(this.cars[carPlate], data.angles || {});
          if (data.angles?.img_front) {
            this.cars[carPlate].image = data.angles.img_front;
            this.cars[carPlate].image_url = data.angles.img_front;
          }
        }

        this.showToast(`✅ อัปโหลดรูปรถ 4 มุมขึ้น Google Drive และอัปเดตข้อมูลรถ (${carPlate}) สำเร็จ!`, "success");
      } else {
        throw new Error(data.detail || data.message || "Upload failed");
      }
    } catch (e) {
      this.showToast(`❌ อัปโหลดรูปรถ 4 มุมไม่สำเร็จ: ` + e.message, "danger");
      const curPhotos = isDisp ? this.assignDispPhotos : this.assignRetPhotos;
      this.renderInspectionPhotosPreview(mode, curPhotos || [], false);
    }
  },

  recalcReturnInspectionDiff() {
    const bkId = document.getElementById("assign-ret-bk")?.value;
    const b = (this.bookings || []).find(x => x.booking_id === bkId);
    const odoDiffEl = document.getElementById("assign-ret-mileage-diff");
    const fuelDiffEl = document.getElementById("assign-ret-fuel-diff");
    const inOdoVal = parseFloat(document.getElementById("assign-ret-odometer")?.value || "");

    if (b && odoDiffEl) {
      const outOdoVal = parseFloat(b.odometer_out || "");
      if (!isNaN(outOdoVal) && !isNaN(inOdoVal) && inOdoVal > 0) {
        const diff = inOdoVal - outOdoVal;
        if (diff >= 0) {
          odoDiffEl.innerHTML = `<span style="color:#059669; font-weight:700;">▲ ใช้งานไป ${diff.toLocaleString()} กม. (จากเลขไมล์ส่งมอบ ${outOdoVal.toLocaleString()})</span>`;
        } else {
          odoDiffEl.innerHTML = `<span style="color:#DC2626; font-weight:700;">⚠️ เลขไมล์น้อยกว่าตอนส่งมอบ (${outOdoVal.toLocaleString()} กม.) กรุณาตรวจสอบ</span>`;
        }
      } else {
        odoDiffEl.innerHTML = "";
      }
    }

    if (b && fuelDiffEl) {
      const outFuel = b.fuel_out || "";
      const inFuel = document.getElementById("assign-ret-fuel")?.value || "";
      if (outFuel && inFuel) {
        const fuelScore = (f) => {
          if (f.includes("เต็มถัง") || f.includes("Full")) return 4;
          if (f.includes("3/4")) return 3;
          if (f.includes("1/2")) return 2;
          if (f.includes("1/4")) return 1;
          return 0;
        };
        const sOut = fuelScore(outFuel);
        const sIn = fuelScore(inFuel);
        if (sIn < sOut) {
          fuelDiffEl.innerHTML = `<span style="color:#DC2626; font-weight:700;">⚠️ น้ำมันน้อยกว่าตอนส่งมอบ (${outFuel}) กรุณาพิจารณาคิดค่าน้ำมันเพิ่ม</span>`;
        } else if (sIn > sOut) {
          fuelDiffEl.innerHTML = `<span style="color:#059669; font-weight:700;">✅ น้ำมันมากกว่าตอนส่งมอบ (${outFuel})</span>`;
        } else {
          fuelDiffEl.innerHTML = `<span style="color:#4B5563;">ระดับน้ำมันเท่ากับตอนส่งมอบ</span>`;
        }
      } else {
        fuelDiffEl.innerHTML = "";
      }
    }
  },

  async submitAssign(jobType, actionType = "prepare") {
    const isDisp = jobType === "Dispatch";
    const bkId = document.getElementById(isDisp ? "assign-disp-bk" : "assign-ret-bk").value;
    const worker = document.getElementById(isDisp ? "assign-disp-worker" : "assign-ret-worker").value;
    const loc = document.getElementById(isDisp ? "assign-disp-loc" : "assign-ret-loc").value;
    const tVal = document.getElementById(isDisp ? "assign-disp-time" : "assign-ret-time").value;
    const sDate = (isDisp ? document.getElementById("assign-disp-date")?.value : null) || document.getElementById(isDisp ? "assign-disp-start-date" : "assign-ret-start-date")?.value || "";
    const eDate = (!isDisp ? document.getElementById("assign-ret-date")?.value : null) || document.getElementById(isDisp ? "assign-disp-end-date" : "assign-ret-end-date")?.value || "";

    const bkObj = (this.bookings || []).find(x => x.booking_id === bkId);
    if (actionType === "handover") {
      if (bkObj && !bkObj.deposit_paid) {
        alert("⚠️ ยังไม่ได้ชำระเงินมัดจำ ไม่สามารถส่งมอบรถได้ (กรุณาไปที่แท็บ \"2. เงินมัดจำ & การเงิน\")");
        return;
      }
      if (bkObj && !bkObj.rental_paid) {
        alert("⚠️ ยังไม่ได้ชำระค่าเช่าคงเหลือ กรุณาชำระค่าเช่าให้เรียบร้อยก่อนส่งมอบรถ (สามารถกดปุ่ม \"กดจ่ายเงินค่าเช่า\" ในหน้านี้ได้ทันที)");
        this.openSettleModal(bkId);
        return;
      }
      if (bkObj && !bkObj.contract_issued) {
        alert("⚠️ สถานะรถจะเปลี่ยนเป็น \"กำลังเช่า\" ได้ก็ต่อเมื่อ \"ออกสัญญาเช่าแล้ว\" เท่านั้น ห้ามเปลี่ยนเป็นกำลังเช่าก่อนออกสัญญาเด็ดขาด กรุณาไปที่แท็บ \"4. จัดทำสัญญาเช่า\" เพื่อตรวจสอบและออกสัญญาเช่าให้เรียบร้อยก่อน");
        return;
      }
    }

    if (actionType === "complete") {
      // Route to inspection modal to ensure checklist and disposition branching (Branch A vs B)
      this.openHandoverModal(bkId, "Return");
      return;
    }

    const thNow = this.getThaiDateTime(0);
    if (isDisp && sDate && sDate < thNow.dateStr && actionType !== "handover") {
      if (!confirm(`⚠️ วันที่ส่งมอบ (${sDate}) เป็นวันย้อนหลังก่อนวันปัจจุบัน (${thNow.dateStr})\nคุณต้องการดำเนินการต่อหรือไม่?`)) {
        return;
      }
    }

    // Construct appointment_datetime from date + time
    const apptDate = isDisp ? sDate : eDate;
    const apptDatetime = (apptDate && tVal) ? `${apptDate} ${tVal}:00` : (apptDate || null);

    // TARGET MISSION 2 & 3: Decoupled API call to insert into work_order_logs
    try {
      await fetch("/api/work-orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          work_type: jobType,
          booking_id: bkId,
          staff_id: worker,
          appointment_datetime: apptDatetime,
          location: loc,
          job_status: actionType === "complete" ? "Completed" : "Pending",
          description: `ใบงาน${isDisp ? "ส่งมอบรถ (Dispatch)" : "รับรถคืน (Return)"} นัดหมาย: ${apptDatetime || '-'} สถานที่: ${loc || '-'}`
        })
      });
    } catch (woErr) {
      console.warn("[WorkOrder] Decoupled work order log creation notice:", woErr);
    }

    // Automatically upload any selected inspection photos if not already uploaded
    const photoInput = document.getElementById(isDisp ? "assign-disp-photos-input" : "assign-ret-photos-input");
    const existingPhotos = isDisp ? (this.assignDispPhotos || []) : (this.assignRetPhotos || []);
    if (photoInput && photoInput.files && photoInput.files.length > 0 && existingPhotos.length === 0) {
      await this.handleInspectionPhotoUpload(photoInput, jobType);
    }

    try {
      const res = await fetch(`/api/bookings/${bkId}/assign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          job_type: jobType,
          action_type: actionType === "handover" ? "handover_now" : (actionType === "complete" ? "complete_now" : "assign"),
          worker: worker,
          staff_id: worker,
          location: loc,
          time: tVal,
          start_date: sDate,
          end_date: eDate,
          appointment_datetime: apptDatetime,
          odometer: (document.getElementById(isDisp ? "assign-disp-odometer" : "assign-ret-odometer")?.value || "").trim(),
          odometer_out: isDisp ? (document.getElementById("assign-disp-odometer")?.value || "").trim() : undefined,
          odometer_in: !isDisp ? (document.getElementById("assign-ret-odometer")?.value || "").trim() : undefined,
          fuel_level: (document.getElementById(isDisp ? "assign-disp-fuel" : "assign-ret-fuel")?.value || "").trim(),
          fuel_out: isDisp ? (document.getElementById("assign-disp-fuel")?.value || "").trim() : undefined,
          fuel_in: !isDisp ? (document.getElementById("assign-ret-fuel")?.value || "").trim() : undefined,
          inspection_notes: (document.getElementById(isDisp ? "assign-disp-notes" : "assign-ret-notes")?.value || "").trim(),
          inspection_notes_out: isDisp ? (document.getElementById("assign-disp-notes")?.value || "").trim() : undefined,
          inspection_notes_in: !isDisp ? (document.getElementById("assign-ret-notes")?.value || "").trim() : undefined,
          remarks: (document.getElementById(isDisp ? "assign-disp-notes" : "assign-ret-notes")?.value || "").trim(),
          damage_notes: (document.getElementById(isDisp ? "assign-disp-notes" : "assign-ret-notes")?.value || "").trim(),
          inspection_categories: {
            petrol: Boolean(document.getElementById(isDisp ? "assign-disp-chk-petrol" : "assign-ret-chk-petrol")?.checked),
            cleanliness: Boolean(document.getElementById(isDisp ? "assign-disp-chk-cleanliness" : "assign-ret-chk-cleanliness")?.checked),
            tires: Boolean(document.getElementById(isDisp ? "assign-disp-chk-tires" : "assign-ret-chk-tires")?.checked),
            interior: Boolean(document.getElementById(isDisp ? "assign-disp-chk-interior" : "assign-ret-chk-interior")?.checked),
            underhood: Boolean(document.getElementById(isDisp ? "assign-disp-chk-underhood" : "assign-ret-chk-underhood")?.checked)
          },
          inspection_categories_out: isDisp ? {
            petrol: Boolean(document.getElementById("assign-disp-chk-petrol")?.checked),
            cleanliness: Boolean(document.getElementById("assign-disp-chk-cleanliness")?.checked),
            tires: Boolean(document.getElementById("assign-disp-chk-tires")?.checked),
            interior: Boolean(document.getElementById("assign-disp-chk-interior")?.checked),
            underhood: Boolean(document.getElementById("assign-disp-chk-underhood")?.checked)
          } : undefined,
          inspection_categories_in: !isDisp ? {
            petrol: Boolean(document.getElementById("assign-ret-chk-petrol")?.checked),
            cleanliness: Boolean(document.getElementById("assign-ret-chk-cleanliness")?.checked),
            tires: Boolean(document.getElementById("assign-ret-chk-tires")?.checked),
            interior: Boolean(document.getElementById("assign-ret-chk-interior")?.checked),
            underhood: Boolean(document.getElementById("assign-ret-chk-underhood")?.checked)
          } : undefined,
          inspection_photos: (isDisp ? (this.assignDispPhotos || []) : (this.assignRetPhotos || [])).length > 0
            ? (isDisp ? this.assignDispPhotos : this.assignRetPhotos).join(",")
            : (document.getElementById(isDisp ? "assign-disp-photos-url" : "assign-ret-photos-url")?.value || ""),
          checkin_img_front: !isDisp ? (document.getElementById("assign-ret-img-front")?.value || "").trim() : undefined,
          checkin_img_left: !isDisp ? (document.getElementById("assign-ret-img-left")?.value || "").trim() : undefined,
          checkin_img_rear: !isDisp ? (document.getElementById("assign-ret-img-rear")?.value || "").trim() : undefined,
          checkin_img_right: !isDisp ? (document.getElementById("assign-ret-img-right")?.value || "").trim() : undefined
        })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        this.showToast("สร้างใบงานสำเร็จ", "success");
        if (typeof Swal !== "undefined") {
          Swal.fire({
            icon: 'success',
            title: 'สร้างใบงานสำเร็จ',
            text: `บันทึกใบงาน ${isDisp ? 'ส่งมอบรถ (Dispatch)' : 'รับรถคืน (Return)'} ลงระบบเรียบร้อยแล้ว`,
            timer: 2000,
            showConfirmButton: false
          });
        }
        this.confirmedAssignSides = this.confirmedAssignSides || {};
        if (!this.confirmedAssignSides[bkId]) {
          this.confirmedAssignSides[bkId] = { Dispatch: false, Return: false };
        }
        this.confirmedAssignSides[bkId][jobType] = true;

        await this.loadBookings();
        await this.loadCars();
        await this.loadBackOfficeJobs();
        if (isDisp) this.onSelectAssignDispBooking();
        else this.onSelectAssignRetBooking();

        if (actionType === "handover") {
          this.showToast(`🎉 ส่งมอบรถ ${bkId} เรียบร้อย! เปลี่ยนสถานะเป็น "กำลังเช่า" 🚗💨`, "success");
        } else if (actionType === "complete") {
          this.showToast(`🏁 รับรถคืน ${bkId} เรียบร้อย! เปลี่ยนสถานะเป็น "เสร็จสิ้น" และปล่อยรถว่างแล้ว 🎉`, "success");
        } else {
          if (isDisp) {
            this.showToast(`✅ บันทึกนัดหมายส่งมอบรถ (${data.booking?.status || 'เตรียมส่งมอบ'}) เรียบร้อย! กำลังไปหน้าจัดทำสัญญา...`, "success");
            this.switchTab("contract");
            const selContractBk = document.getElementById("contract-sel-bk");
            if (selContractBk) {
              selContractBk.value = bkId;
              this.onSelectContractBooking();
            }
          } else {
            this.showToast(`✅ บันทึกเตรียมนัดหมายรับรถคืน (${data.booking?.status || 'เสร็จสิ้น'}) เรียบร้อย!`, "success");
          }
        }
      } else {
        throw new Error(data.detail || data.error || "บันทึกใบงานไม่สำเร็จ");
      }
    } catch (e) {
      alert(e.message);
      this.showToast("เกิดข้อผิดพลาด: " + e.message, "danger");
    }
  },

  async printInspectionForm(jobType) {
    const isEn = (this.currentLang === "EN");
    const isDisp = jobType === "Dispatch";
    const bkId = document.getElementById(isDisp ? "assign-disp-bk" : "assign-ret-bk")?.value;
    if (!bkId) {
      alert(isEn ? "Please select a booking first." : "กรุณาเลือกรหัสการจองก่อนพิมพ์ใบตรวจสภาพรถ");
      return;
    }

    const odoVal = (document.getElementById(isDisp ? "assign-disp-odometer" : "assign-ret-odometer")?.value || "").trim();
    const fuelVal = (document.getElementById(isDisp ? "assign-disp-fuel" : "assign-ret-fuel")?.value || "").trim();
    const notesVal = (document.getElementById(isDisp ? "assign-disp-notes" : "assign-ret-notes")?.value || "").trim();
    const catsObj = {
      petrol: Boolean(document.getElementById(isDisp ? "assign-disp-chk-petrol" : "assign-ret-chk-petrol")?.checked),
      cleanliness: Boolean(document.getElementById(isDisp ? "assign-disp-chk-cleanliness" : "assign-ret-chk-cleanliness")?.checked),
      tires: Boolean(document.getElementById(isDisp ? "assign-disp-chk-tires" : "assign-ret-chk-tires")?.checked),
      interior: Boolean(document.getElementById(isDisp ? "assign-disp-chk-interior" : "assign-ret-chk-interior")?.checked),
      underhood: Boolean(document.getElementById(isDisp ? "assign-disp-chk-underhood" : "assign-ret-chk-underhood")?.checked)
    };

    const bObj = (this.bookings || []).find(x => x.booking_id === bkId) || {};
    const workerVal = document.getElementById(isDisp ? "assign-disp-worker" : "assign-ret-worker")?.value;
    const staffName = workerVal || (isDisp ? bObj.worker_delivery : bObj.worker_return) || "Staff";

    try {
      this.showToast(isEn ? "Generating Inspection PDF..." : "กำลังสร้างเอกสารใบตรวจสภาพรถ...", "info");
      const res = await fetch(`/api/bookings/${bkId}/generate-inspection-pdf`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          inspection_type: isDisp ? "checkout" : "checkin",
          odometer: odoVal,
          odometer_out: isDisp ? odoVal : undefined,
          odometer_in: !isDisp ? odoVal : undefined,
          fuel_level: fuelVal,
          fuel_out: isDisp ? fuelVal : undefined,
          fuel_in: !isDisp ? fuelVal : undefined,
          notes: notesVal,
          remarks: notesVal,
          damage_notes: notesVal,
          inspection_notes: notesVal,
          inspection_notes_out: isDisp ? notesVal : undefined,
          inspection_notes_in: !isDisp ? notesVal : undefined,
          inspection_categories: catsObj,
          inspection_categories_out: isDisp ? catsObj : undefined,
          inspection_categories_in: !isDisp ? catsObj : undefined,
          staff_name: staffName,
          customer_signature: bObj.customer || "Customer"
        })
      });
      const data = await res.json();
      if (data.success && data.pdf_url) {
        if (isDisp) bObj.checkout_pdf_url = data.pdf_url;
        else bObj.checkin_pdf_url = data.pdf_url;
        const openUrl = data.pdf_url.startsWith('http')
          ? data.pdf_url
          : (data.pdf_url + (data.pdf_url.includes('?') ? '&' : '?') + 't=' + Date.now());
        window.open(openUrl, '_blank');
      } else {
        throw new Error(data.detail || "สร้าง PDF ไม่สำเร็จ");
      }
    } catch (e) {
      console.error(e);
      this.showToast("เกิดข้อผิดพลาดในการพิมพ์ใบตรวจสภาพ: " + e.message, "danger");
    }
  },

  onSelectContractBooking() {
    const isEn = (this.currentLang === "EN");
    const bkId = document.getElementById("contract-sel-bk")?.value;
    const card = document.getElementById("contract-details-card");
    const emptyMsg = document.getElementById("contract-empty-msg");
    if (!card) return;

    if (!bkId) {
      card.style.display = "none";
      if (emptyMsg) emptyMsg.style.display = (this.bookings && this.bookings.length === 0) ? "block" : "none";
      return;
    }

    const b = this.bookings.find(x => x.booking_id === bkId);
    if (!b) {
      card.style.display = "none";
      if (emptyMsg) emptyMsg.style.display = "block";
      return;
    }

    if (emptyMsg) emptyMsg.style.display = "none";
    card.style.display = "block";

    const cust = this.customers.find(c => c.full_name === b.customer) || {};
    const car = this.cars.find(c => c.plate === b.car_id) || {};

    // Financial & Status variables declared upfront to avoid ReferenceError / TDZ
    const netP = parseFloat(b.net_price || 0);
    const depAmt = parseFloat(b.deposit_amount || 5000);
    const isDep = !!b.deposit_paid;
    const isRent = !!b.rental_paid;
    const remP = this.computeBookingRemainingBalance(b);

    // Header with badges
    const header = document.getElementById("contract-header-info");
    if (header) {
      const isIssued = !!b.contract_issued;
      header.innerHTML = `
        <div>
          <span style="font-size:18px; font-weight:800; color:#1E3A8A; letter-spacing:0.5px;">📄 ${isEn ? 'Rental Contract ID:' : 'สัญญาเช่ารหัส:'} ${b.booking_id}</span>
          <span style="margin-left:8px;" class="badge ${isIssued ? 'badge-success' : 'badge-warning'}">
            ${isIssued ? (isEn ? '✅ Contract Issued' : '✅ ออกสัญญาเรียบร้อยแล้ว') : (isEn ? '⏳ Awaiting Issuance' : '⏳ รอยืนยันออกสัญญา')}
          </span>
          <span style="margin-left:4px;" class="badge badge-info">${b.status}</span>
        </div>
        <div style="font-size:12px; color:#64748B;">
          📅 ${isEn ? 'Created:' : 'จัดทำ:'} ${b.start_date_formatted || b.start_date} | ${isEn ? 'Recorded by:' : 'ผู้บันทึก:'} ${b.created_by || 'Admin'}
        </div>
      `;
    }

    // Customer
    const custEl = document.getElementById("contract-cust-info");
    if (custEl) {
      custEl.innerHTML = `
        • <b>${isEn ? 'Tenant Name:' : 'ชื่อผู้เช่า:'}</b> ${b.customer}<br/>
        • <b>${isEn ? 'Passport / ID Card:' : 'Passport / เลขบัตร:'}</b> ${cust.passport_id || b.customer_id_card || '-'}<br/>
        • <b>${isEn ? 'Phone / Contact:' : 'เบอร์ติดต่อ:'}</b> ${b.customer_phone || cust.contact_no || '-'}<br/>
        • <b>${isEn ? 'Driving License:' : 'ใบขับขี่:'}</b> ${cust.licence_no || '-'}<br/>
        • <b>${isEn ? 'Nationality:' : 'สัญชาติ:'}</b> ${cust.nationality || 'THAI'}
      `;
    }

    // Car
    const carEl = document.getElementById("contract-car-info");
    if (carEl) {
      carEl.innerHTML = `
        • <b>${isEn ? 'License Plate:' : 'หมายเลขทะเบียน:'}</b> <b style="color:#D97706;">${b.car_id}</b><br/>
        • <b>${isEn ? 'Brand / Model:' : 'ยี่ห้อ/รุ่น:'}</b> ${car.brand || b.car_brand || ''} ${car.model || b.car_model || ''}<br/>
        • <b>${isEn ? 'Group / Color:' : 'กลุ่มรถ/สี:'}</b> ${car.car_group || '-'} / ${car.color || '-'}<br/>
        • <b>${isEn ? 'Company / Fleet:' : 'บริษัทสังกัด:'}</b> ${car.company || '-'}<br/>
        • <b>${isEn ? 'Vehicle Status:' : 'สถานะรถ:'}</b> ${car.fleet_status_desc || car.status || (isEn ? 'Ready for Service' : 'พร้อมใช้งาน')}
      `;
    }

    // Schedule (Editable Thailand Date & Time)
    const schedEl = document.getElementById("contract-sched-info");
    if (schedEl) {
      const thNow = this.getThaiDateTime(0);
      const curSDate = b.start_date || thNow.dateStr;
      const curSTime = b.start_time || thNow.timeStr;
      const curEDate = b.end_date || this.getThaiDateTime(3).dateStr;
      const curETime = b.end_time || thNow.timeStr;
      const curLoc = b.loc_delivery || (isEn ? 'Front Office / Branch' : 'หน้าร้าน / สาขา');
      const curRetLoc = b.loc_return || curLoc;
      const curDelMode = (b.delivery_mode || (parseFloat(b.delivery_fee || 0) > 0 ? 'offsite' : 'branch')).toLowerCase();
      const curPicMode = (b.pickup_mode || (parseFloat(b.pickup_fee || 0) > 0 ? 'offsite' : 'branch')).toLowerCase();
      const curDelFee = parseFloat(b.delivery_fee || 0);
      const curPicFee = parseFloat(b.pickup_fee || 0);
      const isBackdated = curSDate < thNow.dateStr;

      schedEl.innerHTML = `
        <div style="display:flex; flex-direction:column; gap:6px;">
          <div>
            • <b>${isEn ? 'Contract Start (Pick-up Thai Time):' : 'เริ่มสัญญา (Pick-up เวลาไทย):'}</b>
            <div style="display:flex; gap:6px; margin-top:3px;">
              <input type="date" id="contract-edit-start-date" class="form-control" style="padding:4px 8px; font-size:12.5px; border-color:${isBackdated ? '#EF4444' : '#CBD5E1'};" value="${curSDate}" min="${thNow.dateStr}" onchange="app.onContractStartDateChange(this.value)">
              <input type="time" id="contract-edit-start-time" class="form-control" style="padding:4px 8px; font-size:12.5px; max-width:115px;" value="${curSTime}">
            </div>
            <div id="contract-start-date-warn" style="display:${isBackdated ? 'block' : 'none'}; color:#DC2626; font-size:11.5px; font-weight:600; margin-top:4px; background:#FEF2F2; padding:6px 10px; border-radius:6px; border:1px solid #FCA5A5;">
              ${isEn
                ? `⚠️ Backdating protection: Start date (${curSDate}) is in the past (Today is ${thNow.dateStr}). Backdated contracts are not allowed. Please select today or future date.`
                : `⚠️ ป้องกันการลงสัญญาย้อนหลัง: วันที่เริ่มสัญญา (${curSDate}) เป็นวันที่ในอดีต (วันนี้คือ ${thNow.dateStr}) ไม่อนุญาตให้บันทึกสัญญาย้อนหลัง กรุณาแก้ไขวันเริ่มสัญญาเป็นวันนี้หรือวันในอนาคต`}
            </div>
          </div>
          <div>
            • <b>${isEn ? 'Contract End (Return Thai Time):' : 'สิ้นสุดสัญญา (Return เวลาไทย):'}</b>
            <div style="display:flex; gap:6px; margin-top:3px;">
              <input type="date" id="contract-edit-end-date" class="form-control" style="padding:4px 8px; font-size:12.5px;" value="${curEDate}" min="${curSDate > thNow.dateStr ? curSDate : thNow.dateStr}">
              <input type="time" id="contract-edit-end-time" class="form-control" style="padding:4px 8px; font-size:12.5px; max-width:115px;" value="${curETime}">
            </div>
          </div>
          <div style="background:#F8FAFC; border:1px solid #CBD5E1; border-radius:8px; padding:8px 10px; margin-top:4px;">
            <div style="font-size:12px; font-weight:800; color:#1E3A8A; margin-bottom:6px;">🚚 สถานที่ & ค่ารับ-ส่งรถนอกสถานที่ (ปรับยอดอัตโนมัติ):</div>
            <div style="display:grid; grid-template-columns: 115px 1fr 110px; gap:6px; align-items:center; margin-bottom:6px;">
              <select id="contract-edit-del-mode" class="form-control" style="padding:4px 6px; font-size:12px;" onchange="document.getElementById('contract-edit-del-fee').disabled=(this.value==='branch'); if(this.value==='branch') document.getElementById('contract-edit-del-fee').value=0;">
                <option value="branch" ${curDelMode === 'branch' ? 'selected' : ''}>รับที่สาขา</option>
                <option value="offsite" ${curDelMode === 'offsite' ? 'selected' : ''}>🚚 ส่งนอกสถานที่</option>
              </select>
              <input type="text" id="contract-edit-loc" class="form-control" style="padding:4px 8px; font-size:12px;" value="${curLoc}" placeholder="สถานที่ส่งมอบรถ">
              <input type="number" id="contract-edit-del-fee" class="form-control" style="padding:4px 8px; font-size:12px; font-weight:700;" value="${curDelFee}" min="0" max="10000" step="50" ${curDelMode === 'branch' ? 'disabled' : ''} title="ค่าส่งรถ (บาท)">
            </div>
            <div style="display:grid; grid-template-columns: 115px 1fr 110px; gap:6px; align-items:center;">
              <select id="contract-edit-pic-mode" class="form-control" style="padding:4px 6px; font-size:12px;" onchange="document.getElementById('contract-edit-pic-fee').disabled=(this.value==='branch'); if(this.value==='branch') document.getElementById('contract-edit-pic-fee').value=0;">
                <option value="branch" ${curPicMode === 'branch' ? 'selected' : ''}>คืนที่สาขา</option>
                <option value="offsite" ${curPicMode === 'offsite' ? 'selected' : ''}>🚚 รับคืนนอกสถานที่</option>
              </select>
              <input type="text" id="contract-edit-ret-loc" class="form-control" style="padding:4px 8px; font-size:12px;" value="${curRetLoc}" placeholder="สถานที่รับรถคืน">
              <input type="number" id="contract-edit-pic-fee" class="form-control" style="padding:4px 8px; font-size:12px; font-weight:700;" value="${curPicFee}" min="0" max="10000" step="50" ${curPicMode === 'branch' ? 'disabled' : ''} title="ค่ารับรถคืน (บาท)">
            </div>
          </div>
          <div>• <b>${isEn ? 'Assigned Staff:' : 'พนักงานส่งมอบ:'}</b> ${b.worker_delivery || (isEn ? 'Unassigned' : 'ยังไม่ได้มอบหมาย')}</div>
          <div>• <b>${isEn ? 'Current Booking Status:' : 'สถานะการจองปัจจุบัน:'}</b> <span class="badge ${b.status === 'กำลังเช่า' ? 'badge-primary' : (b.status === 'เสร็จสิ้น' ? 'badge-success' : 'badge-info')}">${b.status}</span></div>
          <div style="display:flex; gap:6px; margin-top:6px; flex-wrap:wrap;">
            <!-- ซ่อนปุ่ม 'ใช้วัน-เวลาปัจจุบัน' ออกจากหน้าจอทำสัญญาเช่า -->
            <button type="button" onclick="app.setContractToCurrentThaiTime()" class="btn btn-outline btn-sm" style="display:none; font-size:11.5px; padding:4px 10px;" title="${isEn ? 'Set dates to current Thai time' : 'ปรับวันและเวลาให้ตรงกับปัจจุบัน'}">
              🕒 ${isEn ? 'Use Current Time' : 'ใช้วัน-เวลาปัจจุบัน'}
            </button>
            <button type="button" onclick="app.saveContractSchedule()" class="btn btn-primary btn-sm" style="font-size:11.5px; padding:4px 10px;">
              💾 ${isEn ? 'Save Schedule' : 'บันทึกวัน-เวลาสัญญา'}
            </button>
            ${['รอส่งมอบ', 'เตรียมส่งมอบ'].includes(b.status) && b.contract_issued ? `
            <button type="button" onclick="app.quickConfirmHandover('${b.booking_id}')" class="btn btn-success btn-sm" style="font-size:11.5px; padding:4px 10px; font-weight:600;" title="${isEn ? 'Handed vehicle over to customer ➔ Update status to Renting' : 'ส่งมอบรถให้ลูกค้าแล้ว ➔ ปรับสถานะเป็น กำลังเช่า'}">
              🚚 ${isEn ? 'Handed Over (Renting) ➔' : 'ส่งมอบรถแล้ว (กำลังเช่า) ➔'}
            </button>` : ''}
            ${['กำลังเช่า', 'เตรียมรับคืน'].includes(b.status) ? `
            <button type="button" onclick="app.openExtendContract()" class="btn btn-warning btn-sm" style="font-size:11.5px; padding:4px 10px; font-weight:700; background:#f59e0b; border-color:#d97706; color:#1F2937;" title="${isEn ? 'Extend Contract Period' : 'ต่อสัญญา (Extend Contract)'}">
              📝 ${isEn ? 'Extend Contract' : 'ต่อสัญญา (Extend Contract)'}
            </button>` : ''}
          </div>
          ${!isRent ? `
            <div style="background:#FFFBEB; border:1.5px solid #FCD34D; border-radius:6px; padding:7px 10px; font-size:12px; color:#92400E; margin-top:8px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:6px;">
              <span>⏳ <b>รอชำระค่าเช่าคงเหลือ: ฿${remP.toLocaleString('th-TH', {minimumFractionDigits: 2})}</b></span>
              <button type="button" onclick="app.openSettleModal('${b.booking_id}')" class="btn btn-sm btn-success" style="padding:3px 10px; font-size:11.5px; font-weight:700; background:#10B981; border-color:#059669;">
                💳 ${isEn ? 'Pay Rental Balance' : 'รับชำระค่าเช่าคงเหลือ'}
              </button>
            </div>
          ` : (!b.contract_issued ? `
            <div style="background:#EFF6FF; border:1px solid #BFDBFE; border-radius:6px; padding:7px 10px; font-size:12px; color:#1E40AF; margin-top:8px;">
              📝 <b>ชำระค่าเช่าครบแล้ว</b> ➔ กรุณากดปุ่ม <b>"📝 ดาวน์โหลดสัญญาเช่า (PDF)"</b> เพื่อออกสัญญาและเริ่มการเช่าทันที
            </div>
          ` : `
            <div style="background:#F0FDF4; border:1px solid #BBF7D0; border-radius:6px; padding:7px 10px; font-size:12px; color:#166534; margin-top:8px;">
              ✅ <b>ออกสัญญาเช่าเรียบร้อยแล้ว</b> พร้อมส่งมอบรถ (กำลังเช่า)
            </div>
          `)}
        </div>
      `;
    }

    // Financial
    const netEl = document.getElementById("contract-net-price");
    if (netEl) netEl.textContent = `฿${netP.toLocaleString('th-TH', {minimumFractionDigits: 2})}`;

    const depEl = document.getElementById("contract-dep-status");
    const depSlip = b.deposit_slip || b.payment_slip_url;
    const rentSlip = b.remaining_slip_link || b.rental_slip;
    if (depEl) {
      let refText = b.deposit_ref ? ` (Ref: ${b.deposit_ref})` : '';
      let slipLink = depSlip ? ` <a href="javascript:void(0)" onclick="app.viewSlip('${depSlip}', '${isEn ? 'Deposit Slip' : 'สลิปมัดจำ'} (${b.booking_id})')" style="color:#0284C7; font-size:12px; text-decoration:underline; font-weight:700; cursor:pointer;">[📎 ${isEn ? 'View Deposit Slip' : 'ดูสลิปมัดจำ'}]</a>` : '';
      depEl.innerHTML = isDep 
        ? `<span style="color:#059669;">${isEn ? 'Paid' : 'ชำระแล้ว'} (฿${depAmt.toLocaleString()})${refText}${slipLink}</span>`
        : `<span style="color:#DC2626;">${isEn ? 'Pending Deposit' : 'รอมัดจำ'} (฿${depAmt.toLocaleString()})</span>`;
    }

    const remEl = document.getElementById("contract-rem-price");
    if (remEl) {
      let rentSlipLink = (rentSlip && rentSlip !== depSlip) 
        ? ` <a href="javascript:void(0)" onclick="app.viewSlip('${rentSlip}', '${isEn ? 'Rental Slip' : 'สลิปค่าเช่า'} (${b.booking_id})')" style="color:#059669; font-size:12px; text-decoration:underline; font-weight:700; cursor:pointer;">[📎 ${isEn ? 'View Rental Slip' : 'ดูสลิปค่าเช่า'}]</a>` 
        : '';
      remEl.innerHTML = isRent 
        ? `<span style="color:#059669;">฿0.00 (${isEn ? 'Fully Paid' : 'ชำระครบแล้ว'})${rentSlipLink}</span>`
        : `<span style="color:#E85826;">฿${remP.toLocaleString('th-TH', {minimumFractionDigits: 2})}</span>
           <button type="button" onclick="app.openSettleModal('${b.booking_id}')" class="btn btn-sm btn-success" style="padding:2px 8px; font-size:11px; font-weight:700; margin-left:6px; vertical-align:middle; background:#10B981; border-color:#059669;">
             💳 ${isEn ? 'Pay Balance' : 'รับชำระค่าเช่า'}
           </button>`;
    }

    const contractInspBtn = document.getElementById("btn-contract-print-inspection");
    if (contractInspBtn) {
      contractInspBtn.href = b.checkout_pdf_url || b.checkin_pdf_url || `/api/pdf/inspection/${b.booking_id}`;
      contractInspBtn.style.display = "inline-flex";
    }
    // Extend-contract button only for rentals that are currently On Rent
    const extBtn = document.getElementById("btn-extend-contract");
    if (extBtn) extBtn.style.display = ["กำลังเช่า", "เตรียมรับคืน"].includes(b.status) ? "inline-flex" : "none";
    this.closeExtendContract();

    // Status pill
    const pill = document.getElementById("contract-issued-status-pill");
    if (pill) {
      pill.innerHTML = "";
    }
  },

  onContractStartDateChange(val) {
    const thNow = this.getThaiDateTime(0);
    const warnEl = document.getElementById("contract-start-date-warn");
    const sDateInput = document.getElementById("contract-edit-start-date");
    const eDateInput = document.getElementById("contract-edit-end-date");

    if (eDateInput && val) {
      eDateInput.min = val;
      if (eDateInput.value && eDateInput.value < val) {
        eDateInput.value = val;
      }
    }

    if (val && val < thNow.dateStr) {
      if (sDateInput) sDateInput.style.borderColor = "#EF4444";
      if (warnEl) {
        warnEl.style.display = "block";
        warnEl.innerHTML = `⚠️ ป้องกันการลงสัญญาย้อนหลัง: วันที่เริ่มสัญญา (${val}) เป็นวันที่ในอดีต (วันนี้คือ ${thNow.dateStr}) ไม่อนุญาตให้บันทึกสัญญาย้อนหลัง กรุณาแก้ไขวันเริ่มสัญญาเป็นวันนี้หรือวันในอนาคต`;
      }
    } else {
      if (sDateInput) sDateInput.style.borderColor = "#CBD5E1";
      if (warnEl) warnEl.style.display = "none";
    }
  },

  async setContractToCurrentThaiTime() {
    const thNow = this.getThaiDateTime(0);
    const sDateEl = document.getElementById("contract-edit-start-date");
    const sTimeEl = document.getElementById("contract-edit-start-time");
    const eTimeEl = document.getElementById("contract-edit-end-time");
    if (sDateEl) {
      sDateEl.value = thNow.dateStr;
      this.onContractStartDateChange(thNow.dateStr);
    }
    if (sTimeEl) sTimeEl.value = thNow.timeStr;
    if (eTimeEl) eTimeEl.value = thNow.timeStr;
    await this.saveContractSchedule();
  },

  async saveContractSchedule(silent = false) {
    const bkId = document.getElementById("contract-sel-bk")?.value;
    if (!bkId) return;
    const sDate = document.getElementById("contract-edit-start-date")?.value;
    const sTime = document.getElementById("contract-edit-start-time")?.value;
    const eDate = document.getElementById("contract-edit-end-date")?.value;
    const eTime = document.getElementById("contract-edit-end-time")?.value;
    const loc = document.getElementById("contract-edit-loc")?.value;
    const retLoc = document.getElementById("contract-edit-ret-loc")?.value;
    const delMode = document.getElementById("contract-edit-del-mode")?.value || "branch";
    const picMode = document.getElementById("contract-edit-pic-mode")?.value || "branch";
    const delFee = delMode === "offsite" ? parseFloat(document.getElementById("contract-edit-del-fee")?.value || 0) : 0;
    const picFee = picMode === "offsite" ? parseFloat(document.getElementById("contract-edit-pic-fee")?.value || 0) : 0;

    if (delFee < 0 || picFee < 0 || delFee > 10000 || picFee > 10000) {
      alert("⚠️ ค่ารับ-ส่งรถนอกสถานที่ต้องอยู่ระหว่าง 0 ถึง 10,000 บาทต่อเที่ยว");
      return;
    }

    const thNow = this.getThaiDateTime(0);

    // Validation: prevent backdated contract start date
    if (sDate && sDate < thNow.dateStr) {
      alert(`⚠️ ป้องกันการลงสัญญาเช่าย้อนหลัง!\n\nไม่สามารถบันทึกวันเริ่มสัญญาเป็นวันที่ในอดีตได้ (${sDate})\nวันที่ปัจจุบันของระบบคือ: ${thNow.dateStr}\n\nกรุณาเลือกวันเริ่มสัญญาเป็นวันนี้หรือวันในอนาคต`);
      const sDateEl = document.getElementById("contract-edit-start-date");
      if (sDateEl) {
        sDateEl.value = thNow.dateStr;
        this.onContractStartDateChange(thNow.dateStr);
        sDateEl.focus();
      }
      return;
    }

    if (eDate && sDate && eDate < sDate) {
      alert(`⚠️ วันสิ้นสุดสัญญา (${eDate}) ต้องไม่เกิดขึ้นก่อนวันเริ่มสัญญา (${sDate})`);
      return;
    }

    const payload = {};
    if (sDate) payload.start_date = sDate;
    if (sTime) payload.start_time = sTime;
    if (eDate) payload.end_date = eDate;
    if (eTime) payload.end_time = eTime;
    if (loc !== undefined) payload.loc_delivery = loc;
    if (retLoc !== undefined) payload.loc_return = retLoc;

    try {
      // 1. Update delivery/pickup mode, location, and fees via dedicated PATCH endpoint
      const feeRes = await fetch(`/api/bookings/${bkId}/delivery`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          delivery_mode: delMode,
          pickup_mode: picMode,
          delivery_fee: delFee,
          pickup_fee: picFee,
          loc_delivery: loc || "Sukhumvit",
          loc_return: retLoc || loc || "Sukhumvit"
        })
      });
      const feeData = await feeRes.json();
      if (!feeRes.ok) {
        throw new Error(feeData.detail || "บันทึกค่ารับ-ส่งรถไม่สำเร็จ");
      }

      // 2. Update schedule dates & times
      const res = await fetch(`/api/bookings/${bkId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok || data.detail) {
        throw new Error(data.detail || "บันทึกไม่สำเร็จ");
      }
      if (data.success) {
        if (!silent) {
          this.showToast("✅ บันทึกวัน-เวลาสัญญาเช่า (เวลาประเทศไทย) เรียบร้อย!", "success");
        }
        await this.loadBookings();
        this.onSelectContractBooking();
      }
    } catch (e) {
      if (!silent) this.showToast("เกิดข้อผิดพลาด: " + e.message, "danger");
      alert(e.message);
    }
  },

  async quickConfirmHandover(bkId) {
    if (!bkId) return;
    const b = (this.bookings || []).find(x => x.booking_id === bkId);
    if (!b) return;
    const carPlate = b.car_id || "";
    const custName = b.customer || "";

    if (!b.deposit_paid) {
      alert("⚠️ ยังไม่ได้ชำระเงินมัดจำ ไม่สามารถส่งมอบรถได้ (กรุณาไปที่แท็บ \"2. เงินมัดจำ & การเงิน\")");
      return;
    }
    if (!b.rental_paid) {
      alert("⚠️ ยังไม่ได้ชำระค่าเช่าคงเหลือ กรุณาชำระค่าเช่าให้เรียบร้อยก่อนส่งมอบรถ (สามารถกดปุ่ม \"รับชำระค่าเช่าคงเหลือ\" ได้ทันที)");
      this.openSettleModal(bkId);
      return;
    }
    if (!b.contract_issued) {
      alert("⚠️ สถานะรถจะเปลี่ยนเป็น \"กำลังเช่า\" ได้ก็ต่อเมื่อ \"ออกสัญญาเช่าแล้ว\" เท่านั้น ห้ามเปลี่ยนเป็นกำลังเช่าก่อนออกสัญญาเด็ดขาด กรุณาตรวจสอบเอกสารและกดยืนยันออกสัญญาด้านล่างก่อน");
      return;
    }
    
    if (!confirm(`🚚 ยืนยันการส่งมอบรถ ${carPlate} ให้คุณ ${custName} เรียบร้อยแล้ว?\n\nระบบจะปรับสถานะรายการจองเป็น "กำลังเช่า" และปรับสถานะรถเป็น "กำลังเช่า" ทันที`)) {
      return;
    }

    try {
      const res = await fetch(`/api/bookings/${bkId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "กำลังเช่า" })
      });
      const data = await res.json();
      if (data.success) {
        this.showToast(`🎉 ส่งมอบรถ ${carPlate} สำเร็จ! สถานะเปลี่ยนเป็น "กำลังเช่า" 🚗💨`, "success");
        await this.loadBookings();
        await this.loadCars();
        if (this.activeTab === "contract") this.onSelectContractBooking();
        if (this.activeTab === "assign") {
          this.onSelectAssignDispBooking();
          this.onSelectAssignRetBooking();
        }
      } else {
        throw new Error(data.detail || "อัปเดตสถานะไม่สำเร็จ");
      }
    } catch (e) {
      alert(e.message);
      this.showToast("เกิดข้อผิดพลาด: " + e.message, "danger");
    }
  },

  async quickConfirmReturn(bkId) {
    if (!bkId) return;
    // Strictly open Return Inspection Checklist to enforce Branch A vs Branch B disposition
    this.openHandoverModal(bkId, "Return");
  },

  async markContractIssued() {
    const bkId = document.getElementById("contract-sel-bk")?.value;
    if (!bkId) return;
    try {
      const res = await fetch(`/api/bookings/${bkId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contract_issued: true })
      });
      const data = await res.json();
      if (data.success) {
        this.showToast("✅ บันทึกสถานะออกสัญญาเช่าเรียบร้อย!", "success");
        await this.loadBookings();
        this.onSelectContractBooking();
      } else {
        throw new Error(data.detail || "ไม่สามารถออกสัญญาได้");
      }
    } catch (e) {
      alert(e.message);
      this.showToast("เกิดข้อผิดพลาด: " + e.message, "danger");
    }
  },

  openExtendContract() {
    const bkId = document.getElementById("contract-sel-bk")?.value;
    const b = (this.bookings || []).find(x => x.booking_id === bkId);
    const panel = document.getElementById("contract-extend-panel");
    if (!b || !panel) return;
    if (!["กำลังเช่า", "เตรียมรับคืน"].includes(b.status)) {
      alert("⚠️ ต่อสัญญาได้เฉพาะรายการที่อยู่ในสถานะ \"กำลังเช่า\" เท่านั้น");
      return;
    }
    const curEnd = String(b.end_date || "").split("T")[0];
    const dEl = document.getElementById("contract-extend-end-date");
    const tEl = document.getElementById("contract-extend-end-time");
    const cbEl = document.getElementById("contract-extend-also-rent");
    const info = document.getElementById("contract-extend-current");
    if (info) info.textContent = `สัญญาเดิมสิ้นสุด: ${b.end_date_formatted || curEnd} (${b.end_time || "10:00"} น.)`;
    if (dEl) {
      const d = new Date(`${curEnd}T00:00:00`);
      d.setDate(d.getDate() + 1);
      const nextDay = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      dEl.min = nextDay;
      dEl.value = nextDay;
    }
    if (tEl) tEl.value = b.end_time || "10:00";
    if (cbEl) cbEl.checked = true;
    panel.style.display = "block";
    this.onExtendDateChange();
  },

  closeExtendContract() {
    const panel = document.getElementById("contract-extend-panel");
    if (panel) panel.style.display = "none";
  },

  async onExtendDateChange() {
    const bkId = document.getElementById("contract-sel-bk")?.value;
    const newEnd = document.getElementById("contract-extend-end-date")?.value;
    const prev = document.getElementById("contract-extend-preview");
    const btn = document.getElementById("btn-submit-extend");
    if (!prev || !bkId || !newEnd) return;
    try {
      const res = await fetch(`/api/bookings/${encodeURIComponent(bkId)}/extend-check?new_end_date=${encodeURIComponent(newEnd)}`);
      const data = await res.json();
      if (data.ok) {
        prev.innerHTML = `<span style="color:#15803D; font-weight:700;">✅ คิวว่าง ต่อสัญญาได้</span> · เพิ่ม ${data.extra_days} วัน · ค่าเช่าเพิ่ม ฿${Number(data.extra_price).toLocaleString("th-TH", { minimumFractionDigits: 2 })}`;
        if (btn) btn.disabled = false;
      } else {
        prev.innerHTML = `<span style="color:#DC2626; font-weight:700;">⛔ ${data.message || "ไม่สามารถต่อสัญญาได้"}</span>`;
        if (btn) btn.disabled = true;
      }
    } catch (e) {
      prev.textContent = "ไม่สามารถตรวจสอบคิวได้: " + e.message;
    }
  },

  async submitExtendContract() {
    const bkId = document.getElementById("contract-sel-bk")?.value;
    const newEnd = document.getElementById("contract-extend-end-date")?.value;
    const newTime = document.getElementById("contract-extend-end-time")?.value;
    const alsoRent = Boolean(document.getElementById("contract-extend-also-rent")?.checked);
    const payMethod = document.getElementById("contract-extend-method")?.value || "โอนเงิน / สแกน QR";
    if (!bkId || !newEnd) {
      alert("กรุณาระบุวันที่ต่อสัญญาใหม่");
      return;
    }
    const bObj = this.bookings.find(x => x.booking_id === bkId) || {};
    const conflict = this.findBookingConflict(
      bObj.car_id,
      String(bObj.end_date || "").split("T")[0],
      newEnd,
      bkId
    );
    if (conflict) {
      alert(`⚠️ ไม่สามารถต่อสัญญาได้: ติดจองคิวอื่นในวันที่จะต่อ\n\nรหัสจอง: ${conflict.booking_id}\nลูกค้า: ${conflict.customer}\nช่วงวันที่: ${conflict.start_date_formatted || conflict.start_date} - ${conflict.end_date_formatted || conflict.end_date}`);
      return;
    }
    const payNote = alsoRent ? `พร้อมรับชำระค่าเช่าเต็มจำนวน (${payMethod})` : "โดยรอรับชำระค่าเช่าภายหลัง";
    if (!confirm(`ยืนยันต่อสัญญา ${bkId} ถึงวันที่ ${newEnd} ${payNote} และออกสัญญาเช่าใหม่?`)) return;
    try {
      const res = await fetch(`/api/bookings/${encodeURIComponent(bkId)}/extend`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          new_end_date: newEnd,
          new_end_time: newTime,
          also_pay_rental: alsoRent,
          payment_method: payMethod
        })
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.detail || data.error || "ต่อสัญญาไม่สำเร็จ");
      }
      this.closeExtendContract();
      this.showToast(`🔁 ต่อสัญญา ${bkId} ถึง ${newEnd} เรียบร้อย (+${data.extra_days} วัน ฿${Number(data.extra_price).toLocaleString("th-TH")}) — บันทึกสัญญาใหม่เป็น PDF`, "success");
      await this.loadBookings();
      await this.loadCars();
      this.onSelectContractBooking();
      if (data.pdf_url) window.open(`${data.pdf_url}&t=${Date.now()}`, "_blank");
      if (alsoRent) {
        alert(`✅ ต่อสัญญาและรับชำระค่าเช่าเต็มจำนวน (฿${Number(data.extra_price).toLocaleString("th-TH")}) เรียบร้อยแล้ว`);
      } else {
        alert("✅ ออกสัญญาเช่าใหม่เรียบร้อย (ไฟล์ PDF ถูกดาวน์โหลดแล้ว)\nกรุณาชำระค่าเช่าส่วนที่ต่อที่หน้า \"ชำระเงิน\"");
      }
    } catch (e) {
      alert(e.message);
      this.showToast("เกิดข้อผิดพลาด: " + e.message, "danger");
    }
  },

  goToDepositFromContract() {
    const bkId = document.getElementById("contract-sel-bk")?.value;
    this.switchTab("deposit");
    if (bkId) {
      const depSel = document.getElementById("deposit-sel-booking");
      if (depSel) {
        depSel.value = bkId;
        this.onSelectDepositBooking();
      }
    }
  },

  async downloadContractPdf(bkId) {
    const selBk = document.getElementById("contract-sel-bk")?.value;
    const id = bkId || selBk || document.getElementById("deposit-sel-booking")?.value || this.currentSelectedBooking?.booking_id;
    if (!id) {
      this.showToast("⚠️ กรุณาเลือกรายการจองก่อนดาวน์โหลดสัญญาเช่า", "warning");
      return;
    }
    if (selBk && id === selBk && document.getElementById("contract-edit-start-time")) {
      await this.saveContractSchedule(true);
    }
    const pdfUrl = `/api/pdf/contract/${encodeURIComponent(id)}`;
    this.showToast(`📝 กำลังดาวน์โหลดสัญญาเช่า PDF สำหรับ ${id}...`, "info");
    window.open(`${pdfUrl}?t=${Date.now()}`, "_blank");

    try {
      const bFound = (this.bookings || []).find(x => x.booking_id === id);
      const existingContract = bFound?.contract_pdf_url;
      const finalContractUrl = (existingContract && existingContract.includes("drive.google.com")) ? existingContract : (existingContract || pdfUrl);
      const res = await fetch(`/api/bookings/${encodeURIComponent(id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contract_issued: true,
          contract_pdf_url: finalContractUrl,
          status: "กำลังเช่า",
          dispatch_closed: true
        })
      });
      const data = await res.json();
      if (data.success) {
        this.showToast(`🎉 ออกสัญญาและส่งมอบรถ ${id} เรียบร้อย! เปลี่ยนสถานะเป็น "กำลังเช่า" 🚗💨`, "success");
        await this.loadBookings();
        await this.loadCars();
        await this.loadBackOfficeJobs();
        this.onSelectContractBooking();
      } else if (data.detail) {
        console.warn("Handover on contract download:", data.detail);
      }
    } catch (e) {
      console.error("Contract handover auto-trigger error:", e);
    }
  },

  downloadDepositReceipt(bkId) {
    const id = bkId || document.getElementById("contract-sel-bk")?.value || document.getElementById("deposit-sel-booking")?.value || this.currentSelectedBooking?.booking_id;
    if (!id) {
      this.showToast("⚠️ กรุณาเลือกรายการจองก่อนดาวน์โหลดใบเสร็จมัดจำ", "warning");
      return;
    }
    this.showToast(`🧾 กำลังดาวน์โหลดใบเสร็จรับเงินมัดจำ PDF สำหรับ ${id}...`, "info");
    window.open(`/api/pdf/deposit-receipt/${encodeURIComponent(id)}?t=${Date.now()}`, "_blank");
  },

  downloadRentalReceipt(bkId) {
    const id = bkId || document.getElementById("contract-sel-bk")?.value || document.getElementById("deposit-sel-booking")?.value || this.currentSelectedBooking?.booking_id;
    if (!id) {
      this.showToast("⚠️ กรุณาเลือกรายการจองก่อนดาวน์โหลดใบเสร็จค่าเช่า", "warning");
      return;
    }
    this.showToast(`🧾 กำลังดาวน์โหลดใบเสร็จรับเงินค่าเช่า PDF สำหรับ ${id}...`, "info");
    window.open(`/api/pdf/receipt/${encodeURIComponent(id)}?t=${Date.now()}`, "_blank");
  },

  downloadJobPdf(bkId) {
    const id = bkId || document.getElementById("contract-sel-bk")?.value || document.getElementById("deposit-sel-booking")?.value || this.currentSelectedBooking?.booking_id;
    if (!id) {
      this.showToast("⚠️ กรุณาเลือกรายการจองก่อนดาวน์โหลดใบตรวจสภาพรถ", "warning");
      return;
    }
    this.showToast(`📋 กำลังดาวน์โหลดใบตรวจสภาพรถ PDF สำหรับ ${id}...`, "info");
    window.open(`/api/pdf/job/${encodeURIComponent(id)}?t=${Date.now()}`, "_blank");
  },

  updateBookingMonthOptions(curYm) {
    const sel = document.getElementById("bks-month-filter");
    if (!sel) return;
    const bkCount = (this.bookings || []).length;
    if (sel.dataset.initializedCount === String(bkCount) && sel.options.length > 2) return;

    const isEn = (this.currentLang === "EN");
    const thaiMonths = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
    const enMonths = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

    const monthsSet = new Set();
    monthsSet.add(curYm);
    (this.bookings || []).forEach(b => {
      const d = b.start_date || b.end_date || b.created_at;
      if (d && typeof d === "string") {
        const ym = d.substring(0, 7);
        if (/^\d{4}-\d{2}$/.test(ym)) {
          monthsSet.add(ym);
        }
      }
    });

    const sortedMonths = Array.from(monthsSet).sort().reverse();
    const currentVal = sel.value || "current";

    const [curY, curM] = curYm.split("-");
    const curMIdx = parseInt(curM, 10) - 1;
    const curThYear = parseInt(curY, 10) + 543;
    const curLabel = isEn ? `Current Month (${enMonths[curMIdx]} ${curY})` : `เดือนปัจจุบัน (${thaiMonths[curMIdx]} ${curThYear})`;

    let html = `<option value="current">📅 ${curLabel}</option>`;
    sortedMonths.forEach(ym => {
      const [y, m] = ym.split("-");
      const mIdx = parseInt(m, 10) - 1;
      const thYear = parseInt(y, 10) + 543;
      const label = isEn ? `${enMonths[mIdx]} ${y}` : `${thaiMonths[mIdx]} ${thYear} (${ym})`;
      html += `<option value="${ym}">${label}</option>`;
    });
    html += `<option value="all">📅 ${isEn ? 'All Time (No Filter)' : 'ดูทั้งหมด (All Time)'}</option>`;

    sel.innerHTML = html;
    sel.value = currentVal;
    sel.dataset.initializedCount = String(bkCount);
  },

  renderBookingsTable() {
    const tbody = document.getElementById("bookings-table-body");
    if (!tbody) return;

    const kw = (document.getElementById("bks-search-input")?.value || "").toLowerCase().trim();
    const isEn = (this.currentLang === "EN");
    const stFilter = document.getElementById("bks-status-filter")?.value || "ทั้งหมด";
    const monthFilter = document.getElementById("bks-month-filter")?.value || "current";

    // Current year-month in YYYY-MM format
    const now = new Date();
    const curYear = now.getFullYear();
    const curMonth = String(now.getMonth() + 1).padStart(2, "0");
    const curYm = `${curYear}-${curMonth}`;

    // Dynamically update dropdown options for historical months
    this.updateBookingMonthOptions(curYm);

    const filtered = (this.bookings || []).filter(b => {
      // 1. Status Filter (Target Mission 3: Hide "เสร็จสิ้น" / Completed from active pipeline by default)
      if (stFilter === "ทั้งหมด" || stFilter === "All" || !stFilter) {
        if (b.status === "เสร็จสิ้น" || b.status === "Completed" || b.status === "completed") return false;
      } else if (stFilter !== "all_with_completed") {
        if (b.status !== stFilter) return false;
      }

      // 2. Keyword Filter
      if (kw) {
        const s = `${b.booking_id} ${b.car_id} ${b.customer} ${b.status}`.toLowerCase();
        if (!s.includes(kw)) return false;
      }

      // 3. Month Filter (Default: Current Month, reset view every month, keep DB intact)
      if (monthFilter !== "all") {
        const targetYm = (monthFilter === "current") ? curYm : monthFilter;
        const bStart = b.start_date ? String(b.start_date).split("T")[0] : "";
        const bEnd = b.end_date ? String(b.end_date).split("T")[0] : "";
        const bCreated = b.created_at ? String(b.created_at).split("T")[0] : "";

        const inStart = bStart.startsWith(targetYm);
        const inEnd = bEnd.startsWith(targetYm);
        const inCreated = bCreated.startsWith(targetYm);

        // Also check if rental period spans across the month
        let spansMonth = false;
        if (bStart && bEnd && targetYm.length === 7) {
          const mStart = `${targetYm}-01`;
          const mEnd = `${targetYm}-31`;
          if (bStart <= mEnd && bEnd >= mStart) {
            spansMonth = true;
          }
        }

        if (!inStart && !inEnd && !inCreated && !spansMonth) {
          return false;
        }
      }

      return true;
    });

    if (filtered.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; padding:30px; color:#64748B;">${isEn ? 'No bookings found' : 'ไม่พบรายการจอง'}</td></tr>`;
      return;
    }

    tbody.innerHTML = filtered.map(b => {
      const isDep = b.deposit_paid;
      const isRent = b.rental_paid;
      const netP = parseFloat(b.net_price || 0);

      let depBadge = isDep 
        ? `<span class="badge badge-success">${isEn ? 'Deposit Paid' : 'มัดจำแล้ว'}</span>` 
        : `<span class="badge badge-warning">${isEn ? 'Pending Deposit' : 'รอมัดจำ'}</span>`;
      let rentBadge = isRent 
        ? `<span class="badge badge-success">${isEn ? 'Fully Paid' : 'จ่ายครบ'}</span>` 
        : `<span class="badge badge-danger">${isEn ? 'Unpaid' : 'ค้างชำระ'}</span>`;

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
            ${isEn ? 'to' : 'ถึง'} ${b.end_date_formatted} (${b.end_time || '10:00'})
          </td>
          <td style="font-weight:700; color:#1E293B;">
            ฿${netP.toLocaleString()}
          </td>
          <td>
            ${depBadge} ${rentBadge}
            ${b.deposit_ref ? `<div style="font-size:10.5px; color:#475569; margin-top:3px;">Ref: <code style="background:#FEF3C7; color:#92400E; padding:1px 4px; border-radius:3px;">${b.deposit_ref}</code></div>` : ''}
          </td>
          <td>
            <div style="display:flex; flex-direction:column; align-items:flex-start; gap:4px;">
              <span class="badge ${
                b.status === 'กำลังเช่า' ? 'badge-primary' : 
                (b.status === 'เสร็จสิ้น' ? 'badge-success' : 
                (b.status === 'ยกเลิก' ? 'badge-danger' : 
                (b.status === 'เตรียมส่งมอบ' ? 'badge-warning' : 'badge-info')))
              }">${b.status}</span>
              ${['รอส่งมอบ', 'เตรียมส่งมอบ'].includes(b.status) ? (
                b.contract_issued ? `
                  <button type="button" onclick="app.quickConfirmHandover('${b.booking_id}')" class="btn btn-sm btn-success" style="font-size:11px; padding:2px 8px; white-space:nowrap; border-radius:4px; font-weight:600;" title="${isEn ? 'Handed vehicle over ➔ Update status to Renting' : 'ส่งมอบรถแล้ว ➔ ปรับสถานะเป็น กำลังเช่า'}">
                    🚚 ${isEn ? 'Handed Over' : 'ส่งมอบรถแล้ว'}
                  </button>
                ` : `
                  <button type="button" onclick="app.goToTabWithBooking('contract', '${b.booking_id}')" class="btn btn-sm btn-secondary" style="font-size:10.5px; padding:2px 6px; white-space:nowrap; border-radius:4px; font-weight:600; background:#EFF6FF; border-color:#BFDBFE; color:#1E40AF;" title="${isEn ? 'Issue contract in Tab 4 first' : 'ต้องออกสัญญาเช่าในแท็บ 4 ก่อนส่งมอบรถ'}">
                    📝 ${isEn ? 'Issue Contract' : 'รอออกสัญญา'}
                  </button>
                `
              ) : ''}
              ${['กำลังเช่า', 'เตรียมรับคืน'].includes(b.status) ? `
                <button type="button" onclick="app.openHandoverModal('${b.booking_id}', 'Return')" class="btn btn-sm btn-warning" style="font-size:11px; padding:2px 8px; white-space:nowrap; color:#1E293B; border-radius:4px; font-weight:600;" title="${isEn ? 'Customer returned vehicle ➔ Inspection & Return Checklist' : 'ลูกค้านำรถมาคืน ➔ ตรวจสภาพตาม Checklist และรับรถคืน'}">
                  🏁 ${isEn ? 'Return & Inspect' : 'ตรวจรับรถคืน'}
                </button>
              ` : ''}
            </div>
          </td>
          <td style="text-align:center; white-space:nowrap;">
            ${(() => {
              const depSlip = b.deposit_slip || b.payment_slip_url;
              const rentSlip = b.remaining_slip_link || b.rental_slip;
              const hasDep = Boolean(depSlip);
              const hasRent = Boolean(rentSlip && rentSlip !== depSlip);
              if (hasDep && hasRent) {
                return `
                  <button type="button" onclick="app.viewSlip('${depSlip}', '${isEn ? 'Deposit Slip (Slip 1)' : 'สลิปมัดจำ (ใบที่ 1)'} (${b.booking_id})')" class="btn btn-sm btn-secondary" style="background:#EFF6FF; border-color:#93C5FD; color:#1D4ED8; font-weight:700; padding:2px 6px; font-size:11px;" title="${isEn ? 'View Deposit Slip (Slip 1)' : 'ดูสลิปมัดจำ (ใบที่ 1)'} (Ref: ${b.deposit_ref || '-'})">📎 ${isEn ? 'Deposit' : 'สลิปมัดจำ'}</button>
                  <button type="button" onclick="app.viewSlip('${rentSlip}', '${isEn ? 'Rental Slip (Slip 2)' : 'สลิปค่าเช่า (ใบที่ 2)'} (${b.booking_id})')" class="btn btn-sm btn-secondary" style="background:#F0FDF4; border-color:#86EFAC; color:#15803D; font-weight:700; padding:2px 6px; font-size:11px; margin-left:3px;" title="${isEn ? 'View Rental Balance Slip (Slip 2)' : 'ดูสลิปชำระค่าเช่าคงเหลือ (ใบที่ 2)'} (Ref: ${b.rental_ref || '-'})">📎 ${isEn ? 'Rental' : 'สลิปค่าเช่า'}</button>
                `;
              } else if (hasDep) {
                return `
                  <button type="button" onclick="app.viewSlip('${depSlip}', '${isEn ? 'Deposit Slip' : 'สลิปมัดจำ'} (${b.booking_id})')" class="btn btn-sm btn-secondary" style="background:#EFF6FF; border-color:#93C5FD; color:#1D4ED8; font-weight:700; padding:2px 7px; font-size:11px;" title="${isEn ? 'View Deposit Slip' : 'ดูสลิปมัดจำ'} (Ref: ${b.deposit_ref || '-'})">📎 ${isEn ? 'Deposit Slip' : 'สลิปมัดจำ'}</button>
                `;
              } else if (hasRent) {
                return `
                  <button type="button" onclick="app.viewSlip('${rentSlip}', '${isEn ? 'Rental Slip' : 'สลิปค่าเช่า'} (${b.booking_id})')" class="btn btn-sm btn-secondary" style="background:#F0FDF4; border-color:#86EFAC; color:#15803D; font-weight:700; padding:2px 7px; font-size:11px;" title="${isEn ? 'View Rental Slip' : 'ดูสลิปค่าเช่า'} (Ref: ${b.rental_ref || '-'})">📎 ${isEn ? 'Rental Slip' : 'สลิปค่าเช่า'}</button>
                `;
              }
              return '';
            })()}
            <a href="${b.contract_pdf_url || `/api/pdf/contract/${b.booking_id}`}" target="_blank" class="btn btn-sm btn-secondary" title="${isEn ? 'Rental Agreement PDF' : 'สัญญาเช่า (Rental Agreement PDF)'}">📝</a>
            <a href="/api/pdf/deposit-receipt/${b.booking_id}" target="_blank" class="btn btn-sm btn-secondary" title="${isEn ? 'Deposit Receipt PDF' : 'ใบเสร็จมัดจำ (Deposit Receipt PDF)'}">🛡️</a>
            <a href="/api/pdf/receipt/${b.booking_id}" target="_blank" class="btn btn-sm btn-secondary" title="${isEn ? 'Rental Receipt PDF' : 'ใบเสร็จค่าเช่า (Rental Receipt PDF)'}">🧾</a>
            <a href="${b.checkout_pdf_url || b.checkin_pdf_url || `/api/pdf/job/${b.booking_id}`}" target="_blank" class="btn btn-sm btn-secondary" style="${(b.checkout_pdf_url || b.checkin_pdf_url) ? 'background:#EFF6FF; border-color:#93C5FD; color:#1D4ED8; font-weight:700;' : ''}" title="${isEn ? 'Inspection Job Sheet' : 'ใบงานตรวจสภาพรถ (Job Sheet)'}">📋</a>
            <button type="button" onclick="app.copyCustomerPortalLink('${b.booking_id}')" class="btn btn-sm btn-secondary" style="background:#FAF5FF; border-color:#D8B4FE; color:#7E22CE; font-weight:700;" title="${isEn ? 'Copy Customer Portal Link' : 'คัดลอกลิงก์ Customer Portal ให้ลูกค้าเปิดดูสัญญา/ใบเสร็จ/ใบตรวจสภาพรถ'}">🔗</button>
            <button onclick="app.deleteBooking('${b.booking_id}')" class="btn btn-sm btn-danger" title="${isEn ? 'Delete Booking' : 'ลบรายการจอง'}">🗑️</button>
          </td>
        </tr>
      `;
    }).join("");
  },

  async getCustomerPortalUrl(bkId) {
    const b = (this.bookings || []).find(x => x.booking_id === bkId);
    if (b && b.portal_url) {
      return b.portal_url;
    }
    const res = await fetch(`/api/bookings/${encodeURIComponent(bkId)}/portal-link`);
    const data = await res.json();
    if (!res.ok || !data.portal_url) {
      throw new Error(data.detail || "ไม่สามารถสร้างลิงก์ Customer Portal ได้");
    }
    if (b) {
      b.portal_url = data.portal_url;
      b.portal_token = data.token;
    }
    return data.portal_url;
  },

  async copyCustomerPortalLink(bkId) {
    try {
      const portalPath = await this.getCustomerPortalUrl(bkId);
      const fullUrl = `${window.location.origin}${portalPath}`;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(fullUrl);
      } else {
        const tmp = document.createElement("textarea");
        tmp.value = fullUrl;
        tmp.style.position = "fixed";
        tmp.style.opacity = "0";
        document.body.appendChild(tmp);
        tmp.select();
        document.execCommand("copy");
        document.body.removeChild(tmp);
      }
      this.showToast(`🔗 คัดลอกลิงก์ Customer Portal (${bkId}) เรียบร้อยแล้ว`, "success");
    } catch (e) {
      this.showToast("คัดลอกลิงก์ไม่สำเร็จ: " + e.message, "danger");
    }
  },

  async openCustomerPortal(bkId) {
    try {
      const portalPath = await this.getCustomerPortalUrl(bkId);
      window.open(portalPath, "_blank");
    } catch (e) {
      this.showToast("เปิดลิงก์ Portal ไม่สำเร็จ: " + e.message, "danger");
    }
  },

  async copyCurrentContractPortalLink() {
    const bkId = document.getElementById("contract-sel-bk")?.value;
    if (!bkId) {
      this.showToast("⚠️ กรุณาเลือกรายการจองก่อน", "warning");
      return;
    }
    await this.copyCustomerPortalLink(bkId);
  },

  async openCurrentContractPortal() {
    const bkId = document.getElementById("contract-sel-bk")?.value;
    if (!bkId) {
      this.showToast("⚠️ กรุณาเลือกรายการจองก่อน", "warning");
      return;
    }
    await this.openCustomerPortal(bkId);
  },

  openInspectionPdf(bkId, type = null) {
    const b = (this.bookings || []).find(x => x.booking_id === bkId) || {};
    const isReturned = b.return_closed || b.status === "เสร็จสิ้น" || !!b.return_mileage;
    const reqType = type || (isReturned ? "checkin" : "checkout");
    const url = (reqType === "checkin" && b.checkin_pdf_url)
      ? b.checkin_pdf_url
      : (b.checkout_pdf_url || b.checkin_pdf_url || `/api/pdf/inspection/${bkId}?type=${reqType}`);
    window.open(url, '_blank');
  },

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
});
