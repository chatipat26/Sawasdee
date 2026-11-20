/**
 * Sawasdee Rental - Executive KPIs, Charts, Completed Jobs, Line Expiry Alerts & Modals
 * Prototype Mixin for App
 */
Object.assign(App.prototype, {
  async loadDashboardKPIs() {
    try {
      const res = await fetch(`/api/dashboard/stats?_t=${Date.now()}`, {
        cache: "no-store",
        headers: { "Cache-Control": "no-cache", "Pragma": "no-cache" }
      });
      if (res.ok) {
        this.dashboardStats = await res.json();
        this.rawKpiData = this.dashboardStats;
      }
    } catch (e) {
      console.error("[Dashboard] Error fetching /api/dashboard/stats:", e);
    }

    try {
      this.updateDashboardKPIsFromScope();
    } catch (e) {
      console.error("[Dashboard] Error in updateDashboardKPIsFromScope:", e);
    }

    try {
      this.renderDashboardCharts();
    } catch (e) {
      console.error("[Dashboard] Error in renderDashboardCharts:", e);
    }

    try {
      await this.loadMonthlyReports();
    } catch (e) {
      console.error("[Dashboard] Error in loadMonthlyReports:", e);
    }

    try {
      await this.loadFinanceSummary();
    } catch (e) {
      console.error("[Dashboard] Error in loadFinanceSummary:", e);
    }

    try {
      this.renderFleetOverviewTable();
    } catch (e) {
      console.error("[Dashboard] Error in renderFleetOverviewTable:", e);
    }
  },

  onDashboardScopeChange() {
    this.updateDashboardKPIsFromScope();
    this.renderFleetOverviewTable();
  },

  matchesCompanyScope(rawCompany, scopeVal) {
    if (!scopeVal || scopeVal === "ทั้งหมด") return true;
    const raw = String(rawCompany || "").trim();
    if (raw === scopeVal) return true;
    if (scopeVal === "Sawasdee Rent A Car" && (raw.includes("สวัสดี เรนทัล") || raw.includes("Sawasdee Rental"))) return true;
    if (scopeVal === "P.D.P. Co., Ltd." && (raw.includes("P.D.P") || raw.includes("พี.ดี.พี"))) return true;
    if (scopeVal === "Sawasdee Car Rent" && raw.includes("บี คลิ๊ก")) return true;
    return false;
  },

  updateDashboardKPIsFromScope() {
    try {
      const isEn = (this.currentLang === "EN");
      const data = this.dashboardStats || {};
      const sc = data.status_counts || data.status_breakdown || data.fleet_status_breakdown || {};

      // Robust fallback extraction: never NaN or undefined
      let totalFleet = Number(data.total_fleet ?? data.total_cars ?? (this.cars || []).length ?? 0);
      let availCars = Number(sc.available ?? data.available ?? data.available_cars ?? 0);
      let onRentCars = Number(sc.on_rent ?? sc.rented ?? sc.onRent ?? data.on_rent ?? data.rented_cars ?? 0);
      let bookedCars = Number(sc.booked ?? sc.reserved ?? data.booked ?? data.booked_cars ?? 0);
      let maintCars = Number(sc.maintenance ?? sc.maint ?? data.maintenance ?? data.maintenance_cars ?? 0);

      // FOOLPROOF FALLBACK: If status counts from API are all 0 but this.cars exists in memory
      if (availCars === 0 && onRentCars === 0 && bookedCars === 0 && maintCars === 0 && (this.cars || []).length > 0) {
        totalFleet = this.cars.length;
        this.cars.forEach(c => {
          const st = String(c.status || c.car_status || "").trim().toLowerCase();
          const fKey = String(c.fleet_status_key || "").trim().toLowerCase();
          const isOnRent = Boolean(c.is_on_rent);
          if (isOnRent || fKey === "on_rent" || fKey === "rented" || st.includes("เช่า") || st.includes("rent") || st.includes("รอรับคืน")) {
            onRentCars++;
          } else if (fKey === "maintenance" || fKey === "repair" || st.includes("ซ่อม") || st.includes("ไม่พร้อม") || st.includes("ระงับ") || st.includes("maint") || st.includes("ต่อทะเบียน") || st.includes("ต่อภาษี") || st.includes("workshop") || st.includes("renewal")) {
            const pNorm = String(c.plate || "").replace(/[\s\-\.]+/g, "").toLowerCase();
            const hasActiveMaint = (this.maintenanceRecords || []).some(m => {
              const mpNorm = String(m.car_id || "").replace(/[\s\-\.]+/g, "").toLowerCase();
              const mSt = String(m.status || "").trim();
              return (m.car_id === c.plate || mpNorm === pNorm) && !["เสร็จสิ้น", "ยกเลิก", "completed", "canceled"].includes(mSt.toLowerCase());
            });
            if (hasActiveMaint) {
              maintCars++;
            } else {
              availCars++;
            }
          } else if (fKey === "booked" || fKey === "reserved" || st.includes("จอง") || st.includes("book") || st.includes("reserv") || st.includes("ติดจอง") || st.includes("ส่งมอบ")) {
            bookedCars++;
          } else {
            availCars++;
          }
        });
      }

      // Card 2: on_rent + booked (strictly never including available)
      const activeRentals = (onRentCars + bookedCars);
      const utilRate = (totalFleet > 0 ? ((activeRentals / totalFleet) * 100).toFixed(1) : "0.0");
      const totalRev = Number(data.total_revenue ?? 0);

      const elTotal = document.getElementById("kpi-total-cars");
      const elAvail = document.getElementById("kpi-avail-pill");
      const elActive = document.getElementById("kpi-active-rentals");
      const elMaint = document.getElementById("kpi-maint-pill");
      const elUtil = document.getElementById("kpi-utilization");
      const elRev = document.getElementById("kpi-total-revenue");
      const elInst = document.getElementById("kpi-monthly-installments");
      const elUpd = document.getElementById("dash-last-updated-txt");

      const totalFleetInstallments = (this.cars || []).reduce((sum, c) => {
        const isDebtFree = Boolean(c.is_debt_free);
        const instAmt = parseFloat(c.installment_amount || 0);
        if (!isDebtFree && instAmt > 0) return sum + instAmt;
        return sum;
      }, 0);

      // Card 1: total_fleet and available
      if (elTotal) elTotal.textContent = totalFleet;
      if (elAvail) elAvail.textContent = isEn ? `Available ${availCars} cars` : `พร้อมให้บริการ ${availCars} คัน`;
      
      // Card 2: on_rent + booked and maintenance
      if (elActive) elActive.textContent = activeRentals;
      if (elMaint) elMaint.textContent = isEn ? `Maintenance ${maintCars} cars` : `ซ่อมบำรุง ${maintCars} คัน`;
      
      // Card 3: utilization rate
      if (elUtil) elUtil.textContent = `${utilRate}%`;
      
      // Card 4: revenue
      if (elRev) elRev.textContent = `฿${Number(totalRev).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      if (elInst) elInst.textContent = `฿${totalFleetInstallments.toLocaleString('th-TH', { minimumFractionDigits: 2 })}`;
      if (elUpd) {
        const now = new Date();
        const dd = String(now.getDate()).padStart(2, "0");
        const mm = String(now.getMonth() + 1).padStart(2, "0");
        const yyyy = now.getFullYear();
        const hh = String(now.getHours()).padStart(2, "0");
        const min = String(now.getMinutes()).padStart(2, "0");
        elUpd.textContent = isEn 
          ? `🕒 Real-time updated at ${dd}/${mm}/${yyyy} ${hh}:${min}` 
          : `🕒 ข้อมูลอัปเดตล่าสุด ณ ${dd}/${mm}/${yyyy} ${hh}:${min}`;
      }
    } catch (err) {
      console.error("[Dashboard] Error in updateDashboardKPIsFromScope:", err);
    }
  },

  renderDashboardCharts() {
    this.renderDonutCharts();
    this.renderTrendChart();
  },

  setTrendType(type) {
    this.trendType = type || "bar";
    const btnBar = document.getElementById("btn-trend-bar");
    const btnArea = document.getElementById("btn-trend-area");
    if (this.trendType === "bar") {
      if (btnBar) { btnBar.style.background = "#E85826"; btnBar.style.color = "#FFFFFF"; }
      if (btnArea) { btnArea.style.background = "transparent"; btnArea.style.color = "#6B7280"; }
    } else {
      if (btnArea) { btnArea.style.background = "#E85826"; btnArea.style.color = "#FFFFFF"; }
      if (btnBar) { btnBar.style.background = "transparent"; btnBar.style.color = "#6B7280"; }
    }
    this.renderTrendChart();
  },

  renderDonutCharts() {
    try {
      const canvas = document.getElementById("chart-fleet-status-donut");
      const badge = document.getElementById("donut-total-badge");
      const legend = document.getElementById("fleet-status-legend");
      if (!canvas) {
        console.warn("[Dashboard Donut] Canvas element #chart-fleet-status-donut not found");
        return;
      }
      if (typeof Chart === "undefined") {
        console.warn("[Dashboard Donut] Chart.js library is not loaded");
        return;
      }

      const isEn = (this.currentLang === "EN");
      const data = this.dashboardStats || {};
      const sc = data.status_counts || data.status_breakdown || data.fleet_status_breakdown || {};

      console.log("[Dashboard Donut] Raw API stats received:", data);
      console.log("[Dashboard Donut] Parsed status_counts:", sc);

      // Robust fallback extraction: never NaN or undefined
      let totalCars = Number(data.total_fleet ?? data.total_cars ?? (this.cars || []).length ?? 0);
      let availCount = Number(sc.available ?? data.available ?? data.available_cars ?? 0);
      let rentCount = Number(sc.on_rent ?? sc.rented ?? sc.onRent ?? data.on_rent ?? data.rented_cars ?? 0);
      let bookCount = Number(sc.booked ?? sc.reserved ?? data.booked ?? data.booked_cars ?? 0);
      let maintCount = Number(sc.maintenance ?? sc.maint ?? data.maintenance ?? data.maintenance_cars ?? 0);

      // FOOLPROOF FALLBACK: If status counts from API are all 0 but this.cars exists in memory
      if (availCount === 0 && rentCount === 0 && bookCount === 0 && maintCount === 0 && (this.cars || []).length > 0) {
        console.log("[Dashboard Donut] API returned all 0s, computing counts directly from this.cars:", this.cars.length);
        totalCars = this.cars.length;
        this.cars.forEach(c => {
          const st = String(c.status || c.car_status || "").trim().toLowerCase();
          const fKey = String(c.fleet_status_key || "").trim().toLowerCase();
          const isOnRent = Boolean(c.is_on_rent);
          if (isOnRent || fKey === "on_rent" || fKey === "rented" || st.includes("เช่า") || st.includes("rent") || st.includes("รอรับคืน")) {
            rentCount++;
          } else if (fKey === "maintenance" || fKey === "repair" || st.includes("ซ่อม") || st.includes("ไม่พร้อม") || st.includes("ระงับ") || st.includes("maint") || st.includes("ต่อทะเบียน") || st.includes("ต่อภาษี") || st.includes("workshop") || st.includes("renewal")) {
            const pNorm = String(c.plate || "").replace(/[\s\-\.]+/g, "").toLowerCase();
            const hasActiveMaint = (this.maintenanceRecords || []).some(m => {
              const mpNorm = String(m.car_id || "").replace(/[\s\-\.]+/g, "").toLowerCase();
              const mSt = String(m.status || "").trim();
              return (m.car_id === c.plate || mpNorm === pNorm) && !["เสร็จสิ้น", "ยกเลิก", "completed", "canceled"].includes(mSt.toLowerCase());
            });
            if (hasActiveMaint) {
              maintCount++;
            } else {
              availCount++;
            }
          } else if (fKey === "booked" || fKey === "reserved" || st.includes("จอง") || st.includes("book") || st.includes("reserv") || st.includes("ติดจอง") || st.includes("ส่งมอบ")) {
            bookCount++;
          } else {
            availCount++;
          }
        });
      }

      console.log(`[Dashboard Donut] Final counts => Available: ${availCount}, On Rent: ${rentCount}, Booked: ${bookCount}, Maintenance: ${maintCount}, Total: ${totalCars}`);

      if (badge) {
        badge.textContent = isEn ? `${totalCars} cars` : `${totalCars} คัน`;
      }

      // Safely destroy previous chart instance before re-creating
      if (this.donutChart) {
        try {
          this.donutChart.destroy();
        } catch (e) {
          console.warn("[Dashboard Donut] Error destroying existing chart:", e);
        }
        this.donutChart = null;
      }

      const labels = isEn 
        ? ["Available", "Rented", "Reserved", "Maintenance"]
        : ["ว่างพร้อมให้บริการ", "กำลังเช่า", "ติดจอง", "ซ่อมบำรุง"];
      const colors = ["#10B981", "#3B82F6", "#F59E0B", "#F97316"]; // เขียว, น้ำเงิน, เหลือง, ส้ม

      // If all counts are zero, display a friendly placeholder ring rather than a broken blank canvas
      const isAllZero = (availCount === 0 && rentCount === 0 && bookCount === 0 && maintCount === 0);
      const chartDataArr = isAllZero ? [1] : [availCount, rentCount, bookCount, maintCount];
      const chartColors = isAllZero ? ["#E2E8F0"] : colors;
      const chartLabels = isAllZero ? (isEn ? ["No data"] : ["ไม่มีข้อมูลรถ"]) : labels;

      this.donutChart = new Chart(canvas, {
        type: 'doughnut',
        data: {
          labels: chartLabels,
          datasets: [{
            data: chartDataArr,
            backgroundColor: chartColors,
            borderColor: '#FFFFFF',
            borderWidth: 2,
            hoverOffset: 4
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          cutout: '80%', // Minimalist thin donut ring
          plugins: {
            legend: { display: false },
            tooltip: {
              enabled: !isAllZero,
              callbacks: {
                label: function(ctx) {
                  const val = ctx.raw || 0;
                  const pct = totalCars > 0 ? ((val / totalCars) * 100).toFixed(1) : "0.0";
                  return isEn ? ` ${ctx.label}: ${val} cars (${pct}%)` : ` ${ctx.label}: ${val} คัน (${pct}%)`;
                }
              }
            }
          }
        }
      });

      if (legend) {
        const dataArr = [availCount, rentCount, bookCount, maintCount];
        legend.className = "grid grid-cols-2 gap-2 mt-3 pt-3 border-t border-slate-100";
        legend.style.display = "grid";
        legend.style.gridTemplateColumns = "repeat(2, 1fr)";
        legend.style.gap = "6px 12px";
        legend.innerHTML = labels.map((lbl, idx) => {
          const val = dataArr[idx];
          const pct = totalCars > 0 ? ((val / totalCars) * 100).toFixed(1) : "0.0";
          const cDot = colors[idx];
          return `
            <div style="display:flex; justify-content:space-between; align-items:center; font-size:12px; padding:4px 8px; background:#F8FAFC; border-radius:6px; border:1px solid #F1F5F9;">
              <span style="display:inline-flex; align-items:center; gap:5px; color:#475569;">
                <span style="color:${cDot}; font-size:13px; line-height:1;">●</span>
                <span style="font-weight:600;">${lbl}</span>
              </span>
              <span style="font-weight:700; color:#1E293B;">
                ${val} ${isEn ? 'cars' : 'คัน'} <span style="font-weight:400; color:#94A3B8; font-size:11px;">(${pct}%)</span>
              </span>
            </div>
          `;
        }).join("");
      }
    } catch (err) {
      console.error("[Dashboard Donut] Error in renderDonutCharts:", err);
    }
  },

  renderTrendChart() {
    const canvas = document.getElementById("chart-revenue-trend");
    if (!canvas || typeof Chart === "undefined") return;

    const isEn = (this.currentLang === "EN");
    const thMonthNames = ["", "ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
    const enMonthNames = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const monthNames = isEn ? enMonthNames : thMonthNames;

    let labels = [];
    let dataRev = [];

    if (this.dashboardStats && this.dashboardStats.monthly_trend && this.dashboardStats.monthly_trend.length > 0) {
      const mt = this.dashboardStats.monthly_trend;
      labels = mt.map(b => isEn ? `${enMonthNames[b.month]} ${b.year}` : `${b.month}. ${thMonthNames[b.month]}`);
      dataRev = mt.map(b => Number(b.revenue || 0));
    } else {
      const now = new Date();
      const monthBins = [];
      for (let i = 5; i >= 0; i--) {
        let m = now.getMonth() + 1 - i;
        let y = now.getFullYear();
        while (m <= 0) {
          m += 12;
          y -= 1;
        }
        monthBins.push({
          label: isEn ? `${monthNames[m]} ${y}` : `${m}. ${monthNames[m]}`,
          month: m,
          year: y,
          rev: 0,
          jobs: 0
        });
      }

      (this.completedJobs || []).forEach(item => {
        const dStr = String(item.completed_date || item.end_date || "");
        let dObj = null;
        if (dStr.includes("-")) {
          const p = dStr.split("-");
          if (p.length >= 3) dObj = new Date(parseInt(p[0]), parseInt(p[1]) - 1, parseInt(p[2]));
        } else if (dStr.includes("/")) {
          const p = dStr.split("/");
          if (p.length >= 3) dObj = new Date(parseInt(p[2]), parseInt(p[1]) - 1, parseInt(p[0]));
        }
        if (dObj && !isNaN(dObj.getTime())) {
          const m = dObj.getMonth() + 1;
          const y = dObj.getFullYear();
          const mb = monthBins.find(b => b.month === m && b.year === y);
          if (mb) {
            mb.rev += parseFloat(item.net_price || 0);
            mb.jobs += 1;
          }
        }
      });

      labels = monthBins.map(b => b.label);
      dataRev = monthBins.map(b => b.rev);
    }

    if (this.trendChart) {
      this.trendChart.destroy();
    }

    const isBar = (this.trendType || "bar") === "bar";

    const sumPill = document.getElementById("trend-summary-pill");
    if (sumPill) {
      const totalPeriodRev = dataRev.reduce((a, b) => a + Number(b || 0), 0);
      sumPill.textContent = (isEn ? "Period Rev: " : "รวม 6 เดือน: ") + "฿" + totalPeriodRev.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2});
    }

    this.trendChart = new Chart(canvas, {
      type: isBar ? 'bar' : 'line',
      data: {
        labels: labels,
        datasets: [{
          label: isEn ? 'Total Revenue (THB)' : 'รายรับรวม (THB)',
          data: dataRev,
          backgroundColor: isBar ? '#E85826' : 'rgba(232, 88, 38, 0.12)',
          borderColor: '#E85826',
          borderWidth: isBar ? 0 : 3,
          borderRadius: isBar ? 6 : 0,
          fill: !isBar,
          tension: 0.35,
          pointRadius: isBar ? 0 : 5,
          pointBackgroundColor: '#E85826',
          pointHoverRadius: isBar ? 0 : 7
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: function(ctx) {
                const idx = ctx.dataIndex;
                const val = ctx.raw || 0;
                const jCount = dataJobs[idx] || 0;
                return isEn ? [
                  ` Total Revenue: ฿${val.toLocaleString()} THB`,
                  ` Jobs Completed: ${jCount} jobs`
                ] : [
                  ` รายรับรวม: ฿${val.toLocaleString()} บาท`,
                  ` จำนวนงาน: ${jCount} งาน`
                ];
              }
            }
          }
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: {
              callback: function(val) {
                return '฿' + (val >= 1000 ? (val/1000) + 'k' : val);
              }
            },
            grid: { color: '#F3EDE4' }
          },
          x: {
            grid: { display: false }
          }
        }
      }
    });
  },

  renderCompletedJobsTable() {
    const tbody = document.getElementById("completed-jobs-tbody");
    if (!tbody) return;

    const compFilter = document.getElementById("report-company-filter")?.value || "ทั้งหมด";
    const sbKw = (this.sidebarSearchKw || "").toLowerCase().trim();

    const filtered = (this.completedJobs || []).filter(j => {
      if (compFilter !== "ทั้งหมด" && !this.matchesCompanyScope(j.company, compFilter)) {
        return false;
      }
      if (sbKw) {
        const s = `${j.booking_id || ''} ${j.car_id || ''} ${j.customer || ''} ${j.worker_delivery || ''} ${j.worker_return || ''} ${j.company || ''}`.toLowerCase();
        if (!s.includes(sbKw)) return false;
      }
      return true;
    });

    // Update Expander Title Count
    const isEn = (this.currentLang === "EN");
    const titleEl = document.getElementById("title-expander-completed");
    if (titleEl) {
      titleEl.textContent = isEn
        ? `Completed Jobs Archive & Monthly Reports — (${filtered.length} Records)`
        : `คลังประวัติงานเสร็จสิ้น & รีพอร์ตรายเดือน (Completed Jobs Archive) — (${filtered.length} รายการ)`;
    }

    // Update 4 Monthly Summary KPI Cards (matching app.py lines 7344-7378)
    const totalJobsCnt = filtered.length;
    const totalRevSum = filtered.reduce((sum, x) => sum + parseFloat(x.net_price || 0), 0);
    const uniqueCarsCnt = new Set(filtered.map(x => x.car_id).filter(Boolean)).size;
    const uniqueCustCnt = new Set(filtered.map(x => x.customer).filter(Boolean)).size;

    const elJobs = document.getElementById("rpt-kpi-jobs");
    const elRev = document.getElementById("rpt-kpi-rev");
    const elCars = document.getElementById("rpt-kpi-cars");
    const elCusts = document.getElementById("rpt-kpi-custs");

    if (elJobs) elJobs.innerHTML = `${totalJobsCnt} <span style="font-size:13px; font-weight:500;">${isEn ? 'jobs' : 'งาน'}</span>`;
    if (elRev) elRev.textContent = `฿${totalRevSum.toLocaleString('th-TH', { minimumFractionDigits: 2 })}`;
    if (elCars) elCars.innerHTML = `${uniqueCarsCnt} <span style="font-size:13px; font-weight:500;">${isEn ? 'cars' : 'คัน'}</span>`;
    if (elCusts) elCusts.innerHTML = `${uniqueCustCnt} <span style="font-size:13px; font-weight:500;">${isEn ? 'customers' : 'ราย'}</span>`;

    const photosContainer = document.getElementById("completed-jobs-photos-container");

    if (filtered.length === 0) {
      tbody.innerHTML = `<tr><td colspan="12" style="text-align:center; padding:30px; color:#64748B;">${isEn ? '💡 No completed jobs archive data available in the system.' : '💡 ยังไม่มีข้อมูลประวัติงานที่เสร็จสิ้นในระบบครับ'}</td></tr>`;
      if (photosContainer) photosContainer.innerHTML = "";
      return;
    }

    tbody.innerHTML = filtered.map(j => {
      const bObj = (this.bookings || []).find(b => b.booking_id === j.booking_id) || {};
      const hasCheckinImgs = Boolean(
        j.checkin_img_front || j.checkin_img_left || j.checkin_img_rear || j.checkin_img_right ||
        bObj.checkin_img_front || bObj.checkin_img_left || bObj.checkin_img_rear || bObj.checkin_img_right
      );
      const img4Badge = hasCheckinImgs
        ? `<button type="button" onclick="app.showCheckinImagesModal('${j.booking_id}')" class="btn btn-sm" style="background:#FEF3C7; color:#B45309; border:1px solid #FCD34D; padding:2px 7px; border-radius:10px; font-size:11px; font-weight:700; margin-left:4px; cursor:pointer;" title="${isEn ? 'View 4 Return Photos' : 'คลิกดูรูปรถ 4 มุมตอนรับคืน'}">📸 ${isEn ? '4 Angles' : '4 มุม'}</button>`
        : "";
      const custObj = (this.customers || []).find(c => c.full_name === j.customer) || {};
      const phone = custObj.contact_no && custObj.contact_no !== "-" ? `<div style="font-size:11px; color:#64748B;">📞 ${custObj.contact_no}</div>` : "";
      const locStr = j.loc_return || j.loc_delivery || "-";
      const photos = Array.isArray(j.inspection_photos) ? j.inspection_photos : [];
      const pBadge = photos.length > 0
        ? `<span style="background:#E0E7FF; color:#4338CA; padding:2px 7px; border-radius:10px; font-size:11px; font-weight:700; margin-left:4px;">📸 ${photos.length} ${isEn ? 'photos' : 'รูป'}</span>`
        : "";
      let cType = j.contract_type || 'รายวัน';
      if (isEn) {
        if (cType === 'รายวัน') cType = 'Daily';
        else if (cType === 'รายสัปดาห์') cType = 'Weekly';
        else if (cType === 'รายเดือน') cType = 'Monthly';
      }
      let fuelDisp = j.fuel_level || (isEn ? '⛽ Full Tank (100%)' : '⛽ เต็มถัง (100%)');
      if (isEn && fuelDisp.includes('เต็มถัง')) {
        fuelDisp = fuelDisp.replace('เต็มถัง', 'Full Tank');
      }
      const notes = j.inspection_notes || (isEn ? "Normal inspection" : "ตรวจสภาพปกติ");

      return `
        <tr>
          <td><b style="color:#D97706;">${j.booking_id}</b></td>
          <td style="white-space:nowrap;">📅 ${j.completed_date || j.end_date || '-'}</td>
          <td style="white-space:nowrap;"><b>🚘 ${j.car_id}</b></td>
          <td>
            <b>👤 ${j.customer}</b>
            ${phone}
          </td>
          <td>${j.company || '-'}</td>
          <td><span class="badge badge-gray">${cType}</span></td>
          <td style="text-align:right; font-weight:700; color:#E85826;">฿${parseFloat(j.net_price || 0).toLocaleString('th-TH', { minimumFractionDigits: 2 })}</td>
          <td style="font-size:12px;">${j.worker_delivery || '-'} / ${j.worker_return || '-'}</td>
          <td style="font-size:12px; max-width:140px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${locStr}">${locStr}</td>
          <td>
            <div style="font-size:12px; white-space:nowrap;"><b>${fuelDisp}</b>${pBadge}${img4Badge}</div>
            <div style="font-size:11px; color:#64748B; max-width:160px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${notes}">${notes}</div>
          </td>
          <td><span class="badge badge-success">${isEn ? 'Completed' : 'เสร็จสิ้น'}</span></td>
          <td style="text-align:center; white-space:nowrap;">
            ${hasCheckinImgs ? `<button type="button" onclick="app.showCheckinImagesModal('${j.booking_id}')" class="btn btn-sm btn-secondary" title="${isEn ? 'View 4 Check-in Photos' : 'ดูภาพรับรถคืน 4 มุม'}">📸</button>` : ''}
            <a href="/api/pdf/contract/${j.booking_id}" target="_blank" class="btn btn-sm btn-secondary" title="${isEn ? 'Download Rental Agreement PDF' : 'โหลดสัญญาเช่า PDF'}">📝</a>
            <a href="/api/pdf/receipt/${j.booking_id}" target="_blank" class="btn btn-sm btn-secondary" title="${isEn ? 'Download Receipt PDF' : 'โหลดใบเสร็จ PDF'}">🧾</a>
            <a href="/api/pdf/job/${j.booking_id}" target="_blank" class="btn btn-sm btn-secondary" title="${isEn ? 'Download Vehicle Checklist PDF' : 'โหลดลิสต์ตรวจเช็ครถ PDF'}">📋</a>
          </td>
        </tr>
      `;
    }).join("");

    // Render Collapsible Photo Gallery if any completed job has inspection photos (matching app.py lines 7468-7479)
    if (photosContainer) {
      const jobsWithPhotos = filtered.filter(j => Array.isArray(j.inspection_photos) && j.inspection_photos.length > 0);
      if (jobsWithPhotos.length === 0) {
        photosContainer.innerHTML = "";
      } else {
        const totalPhotoCnt = jobsWithPhotos.reduce((acc, j) => acc + j.inspection_photos.length, 0);
        const galleryItems = jobsWithPhotos.map(j => {
          const imgsHtml = j.inspection_photos.map(p => {
            const src = typeof p === "string" ? p : (p.data || p.url || "");
            const cap = typeof p === "object" && p.name ? p.name : (isEn ? "Vehicle inspection photo" : "ภาพสภาพรถ");
            return `
              <div style="border:1px solid #E2E8F0; border-radius:8px; padding:6px; background:#FFFFFF; text-align:center;">
                <a href="${src}" target="_blank">
                  <img src="${src}" alt="${cap}" style="width:100%; height:130px; object-fit:cover; border-radius:6px;">
                </a>
                <div style="font-size:11px; color:#64748B; margin-top:4px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${cap}</div>
              </div>
            `;
          }).join("");

          return `
            <div style="margin-bottom:14px;">
              <div style="font-size:13px; font-weight:700; color:#1F2937; margin-bottom:6px;">
                🚘 ${j.car_id} | ${isEn ? 'Booking:' : 'รหัส:'} ${j.booking_id} (${j.customer}) — ${isEn ? 'Fuel Level:' : 'ระดับน้ำมัน:'} ${j.fuel_level || '-'}
              </div>
              <div style="display:grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap:10px;">
                ${imgsHtml}
              </div>
            </div>
          `;
        }).join("");

        photosContainer.innerHTML = `
          <details style="background:#F8FAFC; border:1px solid #E2E8F0; border-radius:10px; padding:10px 14px;">
            <summary style="cursor:pointer; font-weight:700; font-size:13px; color:#334155;">
              📸 ${isEn ? 'Vehicle Inspection & Fuel Gauge Photos on Return' : 'คลังรูปภาพสภาพรถ & เกจ์น้ำมันตอนส่งงานปิดจ๊อบ'} (${totalPhotoCnt} ${isEn ? 'Photos' : 'รูป'}) — ${isEn ? 'Click to view evidence photos' : 'คลิกเพื่อดูภาพหลักฐาน'}
            </summary>
            <div style="margin-top:12px;">
              ${galleryItems}
            </div>
          </details>
        `;
      }
    }
  },

  showCheckinImagesModal(bkId) {
    const b = (this.bookings || []).find(x => x.booking_id === bkId)
      || (this.completedJobs || []).find(x => x.booking_id === bkId) || {};
    const isEn = (this.currentLang === "EN");

    const angles = [
      { key: "front", label: isEn ? "Front View" : "ด้านหน้า", url: b.checkin_img_front },
      { key: "left", label: isEn ? "Left View" : "ด้านซ้าย", url: b.checkin_img_left },
      { key: "rear", label: isEn ? "Rear View" : "ด้านหลัง", url: b.checkin_img_rear },
      { key: "right", label: isEn ? "Right View" : "ด้านขวา", url: b.checkin_img_right }
    ];

    const cardsHtml = angles.map(a => {
      const direct = this.convertDriveUrl(a.url);
      if (!direct) {
        return `
          <div style="background:#F8FAFC; border:1px solid #E2E8F0; border-radius:8px; padding:10px; text-align:center;">
            <div style="font-weight:700; font-size:12px; color:#475569; margin-bottom:6px;">🚘 ${a.label}</div>
            <div style="height:120px; display:flex; align-items:center; justify-content:center; background:#F1F5F9; border-radius:6px; color:#94A3B8; font-size:11.5px;">
              ${isEn ? 'No image link' : 'ไม่มีรูปรถ'}
            </div>
          </div>
        `;
      }
      return `
        <div style="background:#F8FAFC; border:1px solid #CBD5E1; border-radius:8px; padding:10px; text-align:center;">
          <div style="font-weight:700; font-size:12px; color:#1E293B; margin-bottom:6px;">🚘 ${a.label}</div>
          <a href="${direct}" target="_blank" title="${isEn ? 'Click to enlarge' : 'คลิกดูภาพขนาดใหญ่'}" style="display:block; height:120px; overflow:hidden; border-radius:6px; border:1px solid #E2E8F0;">
            <img src="${direct}" alt="${a.label}" style="width:100%; height:100%; object-fit:cover;">
          </a>
          <a href="${a.url}" target="_blank" style="display:inline-block; font-size:11px; color:#2563EB; margin-top:6px; text-decoration:none;">🔗 ${isEn ? 'Original Drive Link' : 'ลิงก์ Google Drive'}</a>
        </div>
      `;
    }).join("");

    if (typeof Swal !== "undefined") {
      Swal.fire({
        title: isEn ? `Check-in Return Photos (${bkId})` : `📸 รูปรถยนต์ 4 มุมตอนรับคืน (${bkId})`,
        html: `
          <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px; margin-top:10px; text-align:left;">
            ${cardsHtml}
          </div>
        `,
        width: 600,
        confirmButtonText: isEn ? "Close" : "ปิดหน้าต่าง",
        confirmButtonColor: "#475569"
      });
    } else {
      alert(`รูปรถ 4 มุม (${bkId}):\nหน้า: ${b.checkin_img_front || '-'}\nซ้าย: ${b.checkin_img_left || '-'}\nหลัง: ${b.checkin_img_rear || '-'}\nขวา: ${b.checkin_img_right || '-'}`);
    }
  },

  async triggerLineExpiryCheck() {
    if (this._isSendingLineAlert) return;

    let selectedMode = "broadcast";
    if (typeof Swal !== "undefined") {
      const result = await Swal.fire({
        title: "📲 เลือกกลุ่มเป้าหมายส่งแจ้งเตือน LINE",
        html: `
          <div style="text-align:left; font-size:14px; display:flex; flex-direction:column; gap:12px; margin-top:12px;">
            <label class="line-mode-label" style="display:flex; align-items:flex-start; gap:12px; cursor:pointer; padding:12px; border:2px solid #EA580C; border-radius:10px; background:#FFF7ED; transition:all 0.2s;">
              <input type="radio" name="line_delivery_mode" value="broadcast" checked style="margin-top:4px; accent-color:#EA580C; width:18px; height:18px;">
              <div>
                <b style="color:#C2410C; font-size:15px;">📢 บรอดแคสต์ (ส่งหาผู้ติดตามทุกคน)</b>
                <div style="font-size:12px; color:#64748B; margin-top:3px;">ส่งข้อความถึงทุกคนที่เป็นเพื่อนกับ LINE OA นี้ทันที (พนักงานทุกคนได้รับข้อความ โดยไม่ต้องผูก LINE ID)</div>
              </div>
            </label>
            <label class="line-mode-label" style="display:flex; align-items:flex-start; gap:12px; cursor:pointer; padding:12px; border:1px solid #CBD5E1; border-radius:10px; background:#F8FAFC; transition:all 0.2s;">
              <input type="radio" name="line_delivery_mode" value="admin_only" style="margin-top:4px; accent-color:#EA580C; width:18px; height:18px;">
              <div>
                <b style="color:#1E293B; font-size:15px;">👤 ทดสอบ / ส่งเฉพาะแอดมิน</b>
                <div style="font-size:12px; color:#64748B; margin-top:3px;">ส่งข้อความตรงเฉพาะแอดมินตาม LINE ID ที่ตั้งไว้ในระบบ / .env (Multicast หรือ Direct Push)</div>
              </div>
            </label>
          </div>
        `,
        showCancelButton: true,
        confirmButtonText: "🚀 ส่งข้อความทันที",
        cancelButtonText: "ยกเลิก",
        confirmButtonColor: "#EA580C",
        cancelButtonColor: "#64748B",
        didOpen: () => {
          const labels = document.querySelectorAll('.line-mode-label');
          labels.forEach(lbl => {
            lbl.addEventListener('click', () => {
              labels.forEach(l => {
                l.style.borderColor = '#CBD5E1';
                l.style.backgroundColor = '#F8FAFC';
              });
              lbl.style.borderColor = '#EA580C';
              lbl.style.backgroundColor = '#FFF7ED';
              const rad = lbl.querySelector('input[type="radio"]');
              if (rad) rad.checked = true;
            });
          });
        },
        preConfirm: () => {
          const checked = document.querySelector('input[name="line_delivery_mode"]:checked');
          return checked ? checked.value : "broadcast";
        }
      });
      if (!result.isConfirmed) return;
      selectedMode = result.value || "broadcast";
    }

    this._isSendingLineAlert = true;
    const btn = document.getElementById("btn-dash-line-check");
    if (btn) {
      btn.disabled = true;
      btn.style.opacity = "0.7";
    }

    const modeText = selectedMode === "broadcast" ? "บรอดแคสต์ทุกคน" : "เฉพาะแอดมิน";
    this.showToast(`📲 กำลังตรวจสอบวันหมดอายุ พ.ร.บ./ประกันภัย/ภาษี และส่ง LINE (${modeText})...`, "info");
    try {
      const res = await fetch("/api/line/check-expiry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ check_mode: "weekly", delivery_mode: selectedMode, mode: selectedMode })
      });
      const data = await res.json();
      if (data.sent) {
        if (data.count > 0) {
          this.showToast(`🚨 ส่งแจ้งเตือน LINE สำเร็จ: ${data.count} รายการ (${data.cycle || 'รอบสัปดาห์นี้'}) [${modeText}]!`, "success");
        } else {
          this.showToast(`✅ ส่ง LINE สำเร็จ: ${data.message || 'ไม่มีรถครบกำหนดต่ออายุประกัน พ.ร.บ. ภาษี ในรอบนี้'} [${modeText}]`, "success");
        }
      } else {
        this.showToast(data.message || "ไม่มีรายการครบกำหนดแจ้งเตือนในรอบนี้", "info");
      }
    } catch (e) {
      this.showToast("เกิดข้อผิดพลาด: " + e.message, "danger");
    } finally {
      this._isSendingLineAlert = false;
      if (btn) {
        btn.disabled = false;
        btn.style.opacity = "1";
      }
    }
  },

  onClickKpiFleetCard() {
    this.switchModule("frontoffice");
    this.switchTab("fleet");
    window.scrollTo({ top: 0, behavior: "smooth" });
    this.showToast("🚗 ข้ามมายังหน้าเลือกรถ & จองคิว (Fleet Showcase) เรียบร้อย", "info");
  },

  openActiveRentalsModal() {
    const scopeVal = document.getElementById("dash-company-scope")?.value || "ทั้งหมด";
    const compFilter = document.getElementById("active-rentals-company-filter");
    if (compFilter && scopeVal) {
      compFilter.value = scopeVal;
    }
    const searchInp = document.getElementById("active-rentals-search");
    if (searchInp) searchInp.value = "";
    const statFilter = document.getElementById("active-rentals-status-filter");
    if (statFilter) statFilter.value = "ทั้งหมด";

    this.renderActiveRentalsTable();
    this.openModal("modal-active-rentals");
  },

  renderActiveRentalsTable() {
    const tbody = document.getElementById("active-rentals-tbody");
    if (!tbody) return;

    const kw = (document.getElementById("active-rentals-search")?.value || "").toLowerCase().trim();
    const compFilter = document.getElementById("active-rentals-company-filter")?.value || "ทั้งหมด";
    const statusFilter = document.getElementById("active-rentals-status-filter")?.value || "ทั้งหมด";

    // 1. Gather all active bookings where status is not completed or cancelled
    const activeBks = (this.bookings || []).filter(b => {
      const st = String(b.status || "");
      return !["เสร็จสิ้น", "ยกเลิก"].includes(st);
    });

    const activeRows = [];
    const accountedPlates = new Set();

    activeBks.forEach(b => {
      const car = (this.cars || []).find(c => c.plate === b.car_id) || {};
      const cust = (this.customers || []).find(c => c.full_name === b.customer) || {};
      const company = car.company || b.company || "Sawasdee Rent A Car";

      if (!this.matchesCompanyScope(company, compFilter)) return;
      if (statusFilter !== "ทั้งหมด" && !String(b.status).includes(statusFilter)) return;

      if (kw) {
        const str = `${b.car_id || ''} ${car.brand || ''} ${car.model || ''} ${b.customer || ''} ${cust.contact_no || ''} ${b.status || ''} ${company}`.toLowerCase();
        if (!str.includes(kw)) return;
      }

      accountedPlates.add(b.car_id);
      activeRows.push({
        type: "booking",
        booking_id: b.booking_id,
        car_id: b.car_id,
        car_brand: car.brand || b.car_brand || "",
        car_model: car.model || b.car_model || "",
        car_color: car.color || "",
        company: company,
        customer: b.customer,
        customer_phone: cust.contact_no || b.customer_phone || "-",
        customer_nat: cust.nationality || "THAI",
        start_date: b.start_date_formatted || b.start_date,
        start_time: b.start_time || "10:00",
        end_date: b.end_date_formatted || b.end_date,
        end_time: b.end_time || "10:00",
        status: b.status || "กำลังเช่า",
        net_price: parseFloat(b.net_price || 0),
        deposit_paid: Boolean(b.deposit_paid),
        deposit_amount: parseFloat(b.deposit_amount || 5000),
        worker: b.worker_delivery || b.worker_return || "-",
        location: b.loc_delivery || b.loc_return || "-"
      });
    });

    // 2. Also check if any cars in this.cars have status 'กำลังเช่า', 'ติดจอง' or 'ซ่อมบำรุง' not yet in activeRows
    (this.cars || []).forEach(c => {
      if (accountedPlates.has(c.plate)) return;
      const isMaint = c.fleet_status_key === "maintenance" || c.status === "ซ่อมบำรุง";
      const isRent = c.fleet_status_key === "unavailable" || ["กำลังเช่า", "ติดจอง", "เตรียมส่งมอบ", "เตรียมรับคืน", "รอส่งมอบ"].includes(c.status);

      if (!isMaint && !isRent) return;
      if (!this.matchesCompanyScope(c.company, compFilter)) return;
      if (statusFilter !== "ทั้งหมด" && !String(c.status).includes(statusFilter)) return;

      if (kw) {
        const str = `${c.plate || ''} ${c.brand || ''} ${c.model || ''} ${c.status || ''} ${c.company || ''}`.toLowerCase();
        if (!str.includes(kw)) return;
      }

      activeRows.push({
        type: isMaint ? "maintenance" : "car_status",
        booking_id: "-",
        car_id: c.plate,
        car_brand: c.brand || "",
        car_model: c.model || "",
        car_color: c.color || "",
        company: c.company || "Sawasdee Rent A Car",
        customer: isMaint ? "ศูนย์บริการ/อู่ซ่อมบำรุง" : "ลูกค้าประจำ (สัญญาเดิม)",
        customer_phone: "-",
        customer_nat: "-",
        start_date: "-",
        start_time: "-",
        end_date: "-",
        end_time: "-",
        status: c.status || (isMaint ? "ซ่อมบำรุง" : "กำลังเช่า"),
        net_price: 0,
        deposit_paid: true,
        deposit_amount: 0,
        worker: "-",
        location: "-"
      });
    });

    // Update count badge
    const badge = document.getElementById("active-rentals-count-badge");
    if (badge) badge.textContent = `${activeRows.length} คัน`;

    if (activeRows.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; padding:32px; color:#64748B;">🔍 ไม่พบรายการรถที่กำลังเช่าหรือติดจองตามเงื่อนไขที่เลือก</td></tr>`;
      return;
    }

    tbody.innerHTML = activeRows.map((r, idx) => {
      let statusBadge = '<span class="badge badge-info">' + r.status + '</span>';
      if (r.status === "กำลังเช่า") {
        statusBadge = '<span class="badge" style="background:#ECFDF5; color:#065F46; border:1px solid #A7F3D0; font-weight:700;">🔑 กำลังเช่า</span>';
      } else if (r.status === "เตรียมรับคืน") {
        statusBadge = '<span class="badge" style="background:#EFF6FF; color:#1D4ED8; border:1px solid #BFDBFE; font-weight:700;">🔙 เตรียมรับคืน</span>';
      } else if (r.status === "เตรียมส่งมอบ" || r.status === "รอส่งมอบ") {
        statusBadge = '<span class="badge" style="background:#FFF7ED; color:#C2410C; border:1px solid #FDBA74; font-weight:700;">🚚 เตรียมส่งมอบ</span>';
      } else if (r.status === "ติดจอง") {
        statusBadge = '<span class="badge" style="background:#FEF3C7; color:#92400E; border:1px solid #FDE68A; font-weight:700;">📌 ติดจอง</span>';
      } else if (r.status === "ซ่อมบำรุง") {
        statusBadge = '<span class="badge" style="background:#FEF2F2; color:#991B1B; border:1px solid #FECACA; font-weight:700;">🛠️ ซ่อมบำรุง</span>';
      }

      const depositBadge = r.deposit_paid
        ? `<span style="font-size:11px; color:#047857; font-weight:700;">🟢 มัดจำแล้ว</span>`
        : `<span style="font-size:11px; color:#DC2626; font-weight:700;">🔴 รอมัดจำ</span>`;

      const rentalDatesDisplay = (r.start_date !== "-" && r.end_date !== "-")
        ? `
          <div style="font-size:12px; font-weight:700; color:#1F2937;">
            ${r.start_date} (${r.start_time}) ➔ ${r.end_date} (${r.end_time})
          </div>
          <div style="font-size:11px; color:#64748B;">รหัสจอง: <b>${r.booking_id}</b></div>
        `
        : `<span style="color:#64748B; font-size:12px;">ไม่ได้ระบุช่วงวันสัญญา</span>`;

      const phoneLink = (r.customer_phone && r.customer_phone !== "-")
        ? `<a href="tel:${r.customer_phone}" style="color:#2563EB; font-size:11.5px; text-decoration:none;">📞 ${r.customer_phone}</a>`
        : `<span style="color:#94A3B8; font-size:11px;">-</span>`;

      return `
        <tr>
          <td style="text-align:center; font-weight:700; color:#64748B;">${idx + 1}</td>
          <td>
            <b style="font-size:13.5px; color:#1F2937;">🚘 ${r.car_id}</b><br/>
            <span style="font-size:11.5px; color:#475569;">${r.car_brand} ${r.car_model} (${r.car_color || '-'})</span><br/>
            <span style="font-size:10.5px; color:#94A3B8;">🏢 ${r.company}</span>
          </td>
          <td>
            <b style="font-size:12.5px; color:#1F2937;">👤 ${r.customer}</b><br/>
            ${phoneLink}
          </td>
          <td>${rentalDatesDisplay}</td>
          <td>${statusBadge}</td>
          <td>
            <div style="font-size:11.5px; color:#334155;">📍 ${r.location}</div>
            <div style="font-size:11px; color:#64748B;">👤 ช่าง/คนส่ง: <b>${r.worker}</b></div>
          </td>
          <td style="text-align:right;">
            <b style="font-size:13.5px; color:#EA580C;">฿${r.net_price.toLocaleString('th-TH', { minimumFractionDigits: 2 })}</b><br/>
            ${depositBadge}
          </td>
          <td style="text-align:center; white-space:nowrap;">
            ${r.booking_id !== '-' ? `
              <button onclick="app.closeModal('modal-active-rentals'); app.goToTabWithBooking('assign', '${r.booking_id}')" class="btn btn-sm btn-primary" style="padding:2px 8px; font-size:11px;" title="ไปที่ใบงานนี้">
                📋 ดูใบงาน
              </button>
            ` : `
              <button onclick="app.closeModal('modal-active-rentals'); app.jumpToCarInFrontOffice('${r.car_id}')" class="btn btn-sm btn-secondary" style="padding:2px 8px; font-size:11px;">
                🚗 ดูรถ
              </button>
            `}
          </td>
        </tr>
      `;
    }).join("");
  },

  openCarProfitabilityModal() {
    const scopeVal = document.getElementById("dash-company-scope")?.value || "ทั้งหมด";
    const compFilter = document.getElementById("prof-company-filter");
    if (compFilter && scopeVal) {
      compFilter.value = scopeVal;
    }
    const searchInp = document.getElementById("prof-search-input");
    if (searchInp) searchInp.value = "";
    const sortSel = document.getElementById("prof-sort-select");
    if (sortSel) sortSel.value = "profit_desc";

    this.renderCarProfitabilityTable();
    this.openModal("modal-car-profitability");
  },

  calculateCarProfitabilityList() {
    const revByCar = {};
    const rentalsByCar = {};
    const completedBids = new Set();

    (this.completedJobs || []).forEach(j => {
      const pl = j.car_id;
      if (pl) {
        const netP = parseFloat(j.net_price || 0);
        const late = parseFloat(j.late_fee || 0);
        revByCar[pl] = (revByCar[pl] || 0) + netP + late;
        rentalsByCar[pl] = (rentalsByCar[pl] || 0) + 1;
      }
      if (j.booking_id) completedBids.add(j.booking_id);
    });

    (this.bookings || []).forEach(b => {
      const pl = b.car_id;
      const bid = b.booking_id;
      if (pl && !completedBids.has(bid)) {
        if (b.rental_paid || ["กำลังเช่า", "เตรียมรับคืน", "รอส่งมอบ", "เตรียมส่งมอบ"].includes(b.status)) {
          const netP = parseFloat(b.net_price || 0);
          revByCar[pl] = (revByCar[pl] || 0) + netP;
          rentalsByCar[pl] = (rentalsByCar[pl] || 0) + 1;
        }
      }
    });

    const expByCar = {};
    const mntIds = new Set();
    (this.maintenanceRecords || []).forEach(m => {
      const pl = m.car_id;
      if (pl) {
        const cVal = parseFloat(m.actual_cost || m.cost || 0);
        expByCar[pl] = (expByCar[pl] || 0) + cVal;
      }
      if (m.id) mntIds.add(m.id);
    });

    // In case rawKpiData or financial_records has standalone expenses
    const finRecords = this.rawKpiData?.financial_records || [];
    finRecords.forEach(f => {
      const fType = f.type;
      const fAmt = parseFloat(f.amount || 0);
      const fRef = String(f.ref || "");
      const fDet = String(f.detail || "");

      let matchedPl = null;
      for (const c of (this.cars || [])) {
        if (c.plate === fRef || fDet.includes(c.plate)) {
          matchedPl = c.plate;
          break;
        }
      }

      if (matchedPl) {
        if (fType === "รายรับ" && f.category === "ค่าเช่ารถ" && !completedBids.has(fRef)) {
          revByCar[matchedPl] = (revByCar[matchedPl] || 0) + fAmt;
        } else if (fType === "รายจ่าย" && !mntIds.has(fRef)) {
          expByCar[matchedPl] = (expByCar[matchedPl] || 0) + fAmt;
        }
      }
    });

    const list = (this.cars || []).map(c => {
      const gross = Math.round((revByCar[c.plate] || 0) * 100) / 100;
      const exp = Math.round((expByCar[c.plate] || 0) * 100) / 100;
      const net = Math.round((gross - exp) * 100) / 100;
      const rCnt = rentalsByCar[c.plate] || 0;
      const margin = gross > 0 ? Math.round((net / gross) * 100) : (net < 0 ? -100 : 0);

      return {
        plate: c.plate,
        brand: c.brand || "",
        model: c.model || "",
        color: c.color || "",
        company: c.company || "Sawasdee Rent A Car",
        status: c.status || "ว่างพร้อมใช้งาน",
        total_rentals: rCnt,
        gross_revenue: gross,
        total_expense: exp,
        net_profit: net,
        margin: margin
      };
    });

    return list;
  },

  renderCarProfitabilityTable() {
    const tbody = document.getElementById("car-profitability-tbody");
    if (!tbody) return;

    const kw = (document.getElementById("prof-search-input")?.value || "").toLowerCase().trim();
    const compFilter = document.getElementById("prof-company-filter")?.value || "ทั้งหมด";
    const sortMode = document.getElementById("prof-sort-select")?.value || "profit_desc";

    let list = this.calculateCarProfitabilityList();

    // 1. Filter by company and keyword
    list = list.filter(item => {
      if (!this.matchesCompanyScope(item.company, compFilter)) return false;
      if (kw) {
        const s = `${item.plate} ${item.brand} ${item.model} ${item.company} ${item.status}`.toLowerCase();
        if (!s.includes(kw)) return false;
      }
      return true;
    });

    // 2. Sort: Highest net profit first down to lowest (default)
    if (sortMode === "revenue_desc") {
      list.sort((a, b) => b.gross_revenue - a.gross_revenue || b.net_profit - a.net_profit);
    } else if (sortMode === "rentals_desc") {
      list.sort((a, b) => b.total_rentals - a.total_rentals || b.net_profit - a.net_profit);
    } else {
      // Default: Highest Net Profit first
      list.sort((a, b) => b.net_profit - a.net_profit || b.gross_revenue - a.gross_revenue || b.total_rentals - a.total_rentals);
    }

    // 3. Update top summary metrics in the modal
    const totalGross = list.reduce((acc, x) => acc + x.gross_revenue, 0);
    const totalExp = list.reduce((acc, x) => acc + x.total_expense, 0);
    const totalNet = totalGross - totalExp;

    const elGross = document.getElementById("prof-kpi-gross-rev");
    const elExp = document.getElementById("prof-kpi-total-exp");
    const elNet = document.getElementById("prof-kpi-net-profit");
    const elCars = document.getElementById("prof-kpi-total-cars");

    if (elGross) elGross.textContent = `฿${totalGross.toLocaleString('th-TH', { minimumFractionDigits: 2 })}`;
    if (elExp) elExp.textContent = `-฿${totalExp.toLocaleString('th-TH', { minimumFractionDigits: 2 })}`;
    if (elNet) elNet.textContent = `฿${totalNet.toLocaleString('th-TH', { minimumFractionDigits: 2 })}`;
    if (elCars) elCars.textContent = `${list.length} คัน`;

    if (list.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; padding:32px; color:#64748B;">🔍 ไม่พบข้อมูลรถยนต์ตรงกับเงื่อนไขที่ค้นหา</td></tr>`;
      return;
    }

    tbody.innerHTML = list.map((item, idx) => {
      let rankBadge = `<b style="font-size:13px; color:#64748B;">${idx + 1}</b>`;
      if (idx === 0) rankBadge = `<span style="font-size:18px;" title="อันดับ 1">🥇</span>`;
      else if (idx === 1) rankBadge = `<span style="font-size:18px;" title="อันดับ 2">🥈</span>`;
      else if (idx === 2) rankBadge = `<span style="font-size:18px;" title="อันดับ 3">🥉</span>`;

      let statusBadge = '<span class="badge badge-gray">' + item.status + '</span>';
      if (item.status === "ว่างพร้อมใช้งาน") {
        statusBadge = '<span class="badge badge-success">ว่าง</span>';
      } else if (item.status === "กำลังเช่า") {
        statusBadge = '<span class="badge badge-danger">กำลังเช่า</span>';
      } else if (item.status === "ติดจอง") {
        statusBadge = '<span class="badge badge-warning">ติดจอง</span>';
      } else if (item.status === "ซ่อมบำรุง") {
        statusBadge = '<span class="badge" style="background:#FEE2E2; color:#991B1B;">ซ่อมบำรุง</span>';
      }

      const netColor = item.net_profit > 0 ? "#15803D" : (item.net_profit < 0 ? "#DC2626" : "#475569");
      const netBg = item.net_profit > 0 ? "#F0FDF4" : (item.net_profit < 0 ? "#FEF2F2" : "#F8FAFC");
      const netBorder = item.net_profit > 0 ? "#BBF7D0" : (item.net_profit < 0 ? "#FECACA" : "#E2E8F0");

      return `
        <tr>
          <td style="text-align:center;">${rankBadge}</td>
          <td>
            <b style="font-size:13.5px; color:#1F2937;">🚘 ${item.plate}</b><br/>
            <span style="font-size:11.5px; color:#475569;">${item.brand} ${item.model} (${item.color || '-'})</span><br/>
            <span style="font-size:10.5px; color:#94A3B8;">🏢 ${item.company}</span>
          </td>
          <td style="text-align:center;">${statusBadge}</td>
          <td style="text-align:center;">
            <b style="color:#1E40AF; font-size:13px;">${item.total_rentals}</b> <span style="font-size:11px; color:#64748B;">งาน</span>
          </td>
          <td style="text-align:right;">
            <b style="color:#15803D; font-size:13px;">+฿${item.gross_revenue.toLocaleString('th-TH', { minimumFractionDigits: 2 })}</b>
          </td>
          <td style="text-align:right;">
            <span style="color:#DC2626; font-size:12.5px;">${item.total_expense > 0 ? `-฿${item.total_expense.toLocaleString('th-TH', { minimumFractionDigits: 2 })}` : '฿0.00'}</span>
          </td>
          <td style="text-align:right; background:${netBg};">
            <span style="display:inline-block; padding:3px 10px; border-radius:8px; border:1px solid ${netBorder}; font-weight:800; font-size:14px; color:${netColor};">
              ฿${item.net_profit.toLocaleString('th-TH', { minimumFractionDigits: 2 })}
            </span>
          </td>
          <td style="text-align:center;">
            <button onclick="app.closeModal('modal-car-profitability'); app.jumpToCarInFrontOffice('${item.plate}')" class="btn btn-sm btn-secondary" style="padding:2px 8px; font-size:11px;" title="ดูข้อมูลรถคันนี้ในหน้าเลือกรถ">
              🔍 ดูรถ
            </button>
          </td>
        </tr>
      `;
    }).join("");
  }
});
