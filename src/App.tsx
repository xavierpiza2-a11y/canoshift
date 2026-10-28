/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useCallback } from 'react';
import {
  Employee,
  EmployeeMonthSchedule,
  MonthItem,
  ChangeEntry,
  HistoryEntry,
} from './types/planning';
import {
  DEFAULT_EMPLOYEES,
  DEFAULT_VISIBLE_MONTHS,
  DEFAULT_ALL_MONTHS
} from './config/constants';
import {
  fetchConfig,
  fetchAllSchedules,
  fetchEmployeeSchedule,
  fetchTeamPlanning,
  fetchChanges,
  clearChanges,
  fetchHistory,
  getCachedEmployeeSchedule,
  getCachedTeamPlanning,
  ensureResponsableAdmin,
  getStoreName,
  verifyApiTokenWithStore,
  clearAdminSession
} from './services/api';
import { useOnlineStatus } from './hooks/useOnlineStatus';
import { useRealtimeSync } from './hooks/useRealtimeSync';
import { Header } from './components/Header';
import { BottomNav, TabId } from './components/BottomNav';
import { EmployeeView } from './components/EmployeeView';
import { TeamView } from './components/TeamView';
import { HoursAnalyticsView } from './components/HoursAnalyticsView';
import { AdminView } from './components/AdminView';
import { ProfileSelectorModal } from './components/ProfileSelectorModal';
import { ChangesModal } from './components/ChangesModal';
import { HistoryModal } from './components/HistoryModal';
import { PWAInstallBanner } from './components/PWAInstallBanner';
import { BrandFooter } from './components/BrandFooter';
import { TokenGate } from './components/TokenGate';
import { WifiOff, UserCheck } from 'lucide-react';
import { useTheme } from './hooks/useTheme';

const STORAGE_KEY_EMPLOYEE = 'planning_logged_emp';
const STORAGE_KEY_MONTH = 'planning_selected_month';
const STORAGE_KEY_TOKEN_VALIDATED = 'planning_token_validated';

export default function App() {
  const isOnline = useOnlineStatus();
  useTheme();

  // Mandatory Token Gate State
  const [isTokenValidated, setIsTokenValidated] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem(STORAGE_KEY_TOKEN_VALIDATED) === 'true';
  });
  const [tokenRevokedMessage, setTokenRevokedMessage] = useState<string>('');

  // Dynamic Store Name
  const [storeName, setStoreName] = useState<string>(getStoreName);

  useEffect(() => {
    document.title = `${storeName || 'CanoShift'} · CanoShift`;
  }, [storeName]);

  // App Configuration with strictly enforced Responsable Admin
  const [employees, setEmployees] = useState<Employee[]>(() => {
    if (typeof window === 'undefined') return DEFAULT_EMPLOYEES;
    try {
      const cached = localStorage.getItem('planning_cached_config');
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed.employees && Array.isArray(parsed.employees) && parsed.employees.length > 0) {
          return ensureResponsableAdmin(parsed.employees);
        }
      }
    } catch {
      // ignore
    }
    return ensureResponsableAdmin(DEFAULT_EMPLOYEES);
  });
  const [visibleMonths, setVisibleMonths] = useState<string[]>(DEFAULT_VISIBLE_MONTHS);
  const [allMonths, setAllMonths] = useState<MonthItem[]>(DEFAULT_ALL_MONTHS);

  // Active Employee
  const [currentEmployee, setCurrentEmployee] = useState<Employee | null>(() => {
    if (typeof window === 'undefined') return null;
    try {
      const savedEmpName = localStorage.getItem(STORAGE_KEY_EMPLOYEE);
      if (savedEmpName) {
        const cached = localStorage.getItem('planning_cached_config');
        const list = cached ? JSON.parse(cached).employees : DEFAULT_EMPLOYEES;
        const sanitized = ensureResponsableAdmin(list);
        const match = sanitized.find((e: Employee) => e.name.toLowerCase() === savedEmpName.toLowerCase());
        if (match) return match;
      }
    } catch {
      // ignore
    }
    return null;
  });
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);

  // Navigation & Month (Automatically defaults to current calendar month containing today)
  const [activeTab, setActiveTab] = useState<TabId>('my-planning');
  const [selectedMonth, setSelectedMonth] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem(STORAGE_KEY_MONTH);
      if (saved) return saved;
      const now = new Date();
      const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      const found = DEFAULT_ALL_MONTHS.find((m) => m.key === currentMonthKey);
      if (found) return currentMonthKey;
    }
    return DEFAULT_VISIBLE_MONTHS[0] || '2026-10';
  });

  // Schedules Data: Instant Local Cache display first
  const [mySchedule, setMySchedule] = useState<EmployeeMonthSchedule | null>(() => {
    if (typeof window === 'undefined') return null;
    const savedEmp = localStorage.getItem(STORAGE_KEY_EMPLOYEE);
    const savedMonth = localStorage.getItem(STORAGE_KEY_MONTH) || '2026-10';
    return savedEmp ? getCachedEmployeeSchedule(savedEmp, savedMonth) : null;
  });

  const [teamSchedules, setTeamSchedules] = useState<Record<string, EmployeeMonthSchedule>>(() => {
    if (typeof window === 'undefined') return {};
    const savedMonth = localStorage.getItem(STORAGE_KEY_MONTH) || '2026-10';
    return getCachedTeamPlanning(savedMonth) || {};
  });

  const [isLoadingMySchedule, setIsLoadingMySchedule] = useState(false);
  const [isLoadingTeam, setIsLoadingTeam] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isDataOffline, setIsDataOffline] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState<Date | null>(null);

  // Notifications & Changes
  const [changesList, setChangesList] = useState<ChangeEntry[]>([]);
  const [isChangesModalOpen, setIsChangesModalOpen] = useState(false);
  const [historyList, setHistoryList] = useState<HistoryEntry[]>([]);
  const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);

  // Global Admin Mode activation state (protected strictly by PIN)
  const [isAdminActive, setIsAdminActive] = useState<boolean>(false);

  // Check if active profile has administrator rights (Responsable is automatically & permanently admin)
  const isCurrentEmployeeAdmin = Boolean(
    currentEmployee &&
      (currentEmployee.isAdmin ||
        (currentEmployee.role &&
          currentEmployee.role.trim().toLowerCase().includes('responsable')) ||
        currentEmployee.name.trim().toLowerCase() === 'responsable')
  );

  // If active profile is not an admin, ensure admin session is always deactivated
  useEffect(() => {
    if (!isCurrentEmployeeAdmin && isAdminActive) {
      setIsAdminActive(false);
    }
  }, [isCurrentEmployeeAdmin, isAdminActive]);

  // Initial Load: Config & Stored Employee
  useEffect(() => {
    if (!isTokenValidated) return;

    const now = new Date();
    const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const storedMonth = localStorage.getItem(STORAGE_KEY_MONTH);

    let initialEmployeesList = ensureResponsableAdmin(DEFAULT_EMPLOYEES);

    const cachedConfig = localStorage.getItem('planning_cached_config');
    if (cachedConfig) {
      try {
        const parsed = JSON.parse(cachedConfig);
        if (parsed.employees && Array.isArray(parsed.employees) && parsed.employees.length > 0) {
          const withResponsable = ensureResponsableAdmin(parsed.employees);
          initialEmployeesList = withResponsable;
          setEmployees(withResponsable);
        }
      } catch {
        // ignore
      }
    }

    fetchConfig().then((cfg) => {
      if (cfg) {
        if (cfg.storeName) {
          setStoreName(cfg.storeName);
        }
        if (cfg.apiToken) {
          const savedToken = (localStorage.getItem('planning_api_token') || '').trim().toUpperCase();
          if (savedToken && savedToken !== cfg.apiToken.trim().toUpperCase()) {
            localStorage.removeItem(STORAGE_KEY_TOKEN_VALIDATED);
            setIsTokenValidated(false);
            setTokenRevokedMessage("La clé d'accès a été modifiée par l'administrateur. Veuillez saisir la nouvelle clé.");
          }
        }
        if (cfg.employees && cfg.employees.length > 0) {
          const sanitizedEmployees = ensureResponsableAdmin(cfg.employees);
          setEmployees(sanitizedEmployees);
          initialEmployeesList = sanitizedEmployees;
        }
        if (cfg.visibleMonths && cfg.visibleMonths.length > 0) {
          setVisibleMonths(cfg.visibleMonths);
        }
        if (cfg.allMonths && cfg.allMonths.length > 0) {
          setAllMonths(cfg.allMonths);
        }

        if (storedMonth && cfg.allMonths.some((m) => m.key === storedMonth)) {
          setSelectedMonth(storedMonth);
        } else if (cfg.visibleMonths.includes(currentMonthKey)) {
          setSelectedMonth(currentMonthKey);
        } else if (cfg.visibleMonths.length > 0) {
          setSelectedMonth(cfg.visibleMonths[0]);
        }
      }

      // Check saved employee against the actual employee list
      const savedEmpName = localStorage.getItem(STORAGE_KEY_EMPLOYEE);
      if (savedEmpName) {
        const match = initialEmployeesList.find((e: Employee) => e.name.toLowerCase() === savedEmpName.toLowerCase());
        if (match) {
          const isResp = Boolean(
            match.name.toLowerCase() === 'responsable' ||
            (match.role && match.role.toLowerCase().includes('responsable'))
          );
          const safeMatch = isResp ? { ...match, role: 'Responsable', isAdmin: true } : match;
          setCurrentEmployee(safeMatch);
        } else if (initialEmployeesList.length > 0) {
          const safeFirst = initialEmployeesList[0];
          setCurrentEmployee(safeFirst);
          localStorage.setItem(STORAGE_KEY_EMPLOYEE, safeFirst.name);
        }
      } else {
        const resp = initialEmployeesList.find((e: Employee) => e.name.toLowerCase() === 'responsable') || initialEmployeesList[0];
        if (resp) {
          setCurrentEmployee(resp);
          localStorage.setItem(STORAGE_KEY_EMPLOYEE, resp.name);
        }
        setIsProfileModalOpen(true);
      }
      // Populate exercise schedules cache in the background
      fetchAllSchedules();
    });
  }, [isTokenValidated]);

  // Handle successful token validation
  useEffect(() => {
    const onAuthLost = () => {
      localStorage.removeItem(STORAGE_KEY_TOKEN_VALIDATED);
      setIsTokenValidated(false);
      setTokenRevokedMessage("La clé d'accès a été modifiée par l'administrateur. Veuillez saisir la nouvelle clé.");
    };
    const onAdminExpired = () => setIsAdminActive(false);
    window.addEventListener('canoshift:auth-lost', onAuthLost);
    window.addEventListener('canoshift:admin-expired', onAdminExpired);
    return () => {
      window.removeEventListener('canoshift:auth-lost', onAuthLost);
      window.removeEventListener('canoshift:admin-expired', onAdminExpired);
    };
  }, []);

  const handleTokenSuccess = (_token: string, store?: { id: string; name: string; token: string }) => {
    localStorage.setItem(STORAGE_KEY_TOKEN_VALIDATED, 'true');
    setTokenRevokedMessage('');
    setIsTokenValidated(true);

    if (store && store.name) {
      setStoreName(store.name);
    }

    // Immediately fetch latest store config & schedules for this specific store
    fetchConfig().then((cfg) => {
      if (cfg) {
        if (cfg.storeName) setStoreName(cfg.storeName);
        if (cfg.employees) {
          const emps = ensureResponsableAdmin(cfg.employees);
          setEmployees(emps);
          const savedEmpName = localStorage.getItem(STORAGE_KEY_EMPLOYEE);
          const match = savedEmpName
            ? emps.find((e: Employee) => e.name.toLowerCase() === savedEmpName.toLowerCase())
            : null;
          if (match) {
            setCurrentEmployee(match);
          } else {
            setCurrentEmployee(emps[0] || null);
            setIsProfileModalOpen(true);
          }
        }
        if (cfg.visibleMonths) setVisibleMonths(cfg.visibleMonths);
        if (cfg.allMonths) setAllMonths(cfg.allMonths);
      }
      fetchAllSchedules();
    });
  };

  // Lock and return to token gate
  const handleLockToTokenGate = () => {
    localStorage.removeItem(STORAGE_KEY_TOKEN_VALIDATED);
    setIsTokenValidated(false);
  };

  // Update selected month handler
  const handleSelectMonth = (monthKey: string) => {
    setSelectedMonth(monthKey);
    localStorage.setItem(STORAGE_KEY_MONTH, monthKey);

    // Instant local cache switch
    if (currentEmployee) {
      const cachedMy = getCachedEmployeeSchedule(currentEmployee.name, monthKey);
      if (cachedMy) setMySchedule(cachedMy);
    }
    const cachedTeam = getCachedTeamPlanning(monthKey);
    if (cachedTeam) setTeamSchedules(cachedTeam);
  };

  // Switch Employee
  const handleSelectEmployee = (emp: Employee) => {
    setCurrentEmployee(emp);
    localStorage.setItem(STORAGE_KEY_EMPLOYEE, emp.name);

    const isNewEmpAdmin = Boolean(
      emp.isAdmin ||
        (emp.role && emp.role.trim().toLowerCase().includes('responsable')) ||
        emp.name.trim().toLowerCase() === 'responsable'
    );
    const safeEmp = isNewEmpAdmin
      ? { ...emp, role: emp.role || 'Responsable', isAdmin: true }
      : emp;
    setCurrentEmployee(safeEmp);
    localStorage.setItem(STORAGE_KEY_EMPLOYEE, safeEmp.name);

    if (!isNewEmpAdmin) {
      setIsAdminActive(false);
    }

    // Instant local cache switch for the selected employee
    const cached = getCachedEmployeeSchedule(safeEmp.name, selectedMonth);
    if (cached) {
      setMySchedule(cached);
    }
  };

  // Load individual schedule: display local cache instantly, fetch live in background
  const loadMySchedule = useCallback(async (empName: string, month: string) => {
    if (!empName || !month) return;

    // 1. Immediately read and display cache if available
    const cached = getCachedEmployeeSchedule(empName, month);
    if (cached) {
      setMySchedule(cached);
    } else {
      setMySchedule((prev) => {
        if (!prev || prev.month !== month || prev.employee !== empName) {
          setIsLoadingMySchedule(true);
          return null;
        }
        return prev;
      });
    }

    // 2. Fetch live data discreetly in the background
    setIsSyncing(true);
    try {
      const { schedule, isOffline } = await fetchEmployeeSchedule(empName, month);
      setMySchedule(schedule);
      setIsDataOffline(isOffline);
      setLastSyncTime(new Date());
    } catch (err) {
      console.warn('Background sync failed:', err);
    } finally {
      setIsLoadingMySchedule(false);
      setIsSyncing(false);
    }
  }, []);

  // Load team schedule: display local cache instantly, fetch live in background
  const loadTeamSchedule = useCallback(async (month: string, currentEmps: Employee[]) => {
    if (!month || currentEmps.length === 0) return;

    // 1. Immediately read and display cache if available
    const cached = getCachedTeamPlanning(month);
    if (cached && Object.keys(cached).length > 0) {
      setTeamSchedules(cached);
    } else {
      setTeamSchedules((prev) => {
        if (!prev || Object.keys(prev).length === 0) {
          setIsLoadingTeam(true);
        }
        return prev;
      });
    }

    // 2. Fetch live data discreetly in the background
    setIsSyncing(true);
    try {
      const { teamSchedules: schedules, updatedEmployees, isOffline } = await fetchTeamPlanning(
        month,
        currentEmps
      );
      setTeamSchedules(schedules);
      if (updatedEmployees && updatedEmployees.length > 0) {
        setEmployees(updatedEmployees);
      }
      setIsDataOffline(isOffline);
      setLastSyncTime(new Date());
    } catch (err) {
      console.warn('Background team sync failed:', err);
    } finally {
      setIsLoadingTeam(false);
      setIsSyncing(false);
    }
  }, []);

  // Real-Time WebSocket updates from the Database
  const handleRealtimeMessage = useCallback(
    (msg: any) => {
      if (msg.type === 'SHIFT_UPDATED') {
        if (msg.monthKey === selectedMonth && msg.schedule) {
          setTeamSchedules((prev) => ({
            ...prev,
            [msg.employeeName]: msg.schedule,
          }));
          if (
            currentEmployee &&
            currentEmployee.name.toLowerCase() === msg.employeeName.toLowerCase()
          ) {
            setMySchedule(msg.schedule);
          }
        }
      } else if (msg.type === 'SCHEDULES_UPDATED') {
        if (msg.monthKey === selectedMonth && msg.teamSchedules) {
          setTeamSchedules(msg.teamSchedules);
          if (currentEmployee && msg.teamSchedules[currentEmployee.name]) {
            setMySchedule(msg.teamSchedules[currentEmployee.name]);
          }
        }
      } else if (msg.type === 'SCHEDULES_GENERATED') {
        // Journées générées par le serveur (nouveau salarié / mois / exercice) : on recharge le mois affiché
        if (Array.isArray(msg.months) && msg.months.includes(selectedMonth)) {
          loadTeamSchedule(selectedMonth, employees);
          if (currentEmployee) loadMySchedule(currentEmployee.name, selectedMonth);
        }
      } else if (msg.type === 'TOKEN_CHANGED') {
        const savedToken = (localStorage.getItem('planning_api_token') || '').trim().toUpperCase();
        verifyApiTokenWithStore(savedToken).then((result) => {
          if (!result.valid) {
            localStorage.removeItem(STORAGE_KEY_TOKEN_VALIDATED);
            setIsTokenValidated(false);
            setTokenRevokedMessage("La clé d'accès a été modifiée par l'administrateur. Veuillez saisir la nouvelle clé.");
          }
        });
      } else if (msg.type === 'PIN_CHANGED') {
        clearAdminSession();
        setIsAdminActive(false);
      } else if (msg.type === 'CONFIG_UPDATED') {
        if (msg.config) {
          if (msg.config.employees) setEmployees(ensureResponsableAdmin(msg.config.employees));
          if (msg.config.visibleMonths) setVisibleMonths(msg.config.visibleMonths);
          if (msg.config.allMonths) setAllMonths(msg.config.allMonths);
          if (msg.config.storeName) setStoreName(msg.config.storeName);
          if (msg.config.apiToken) {
            const savedToken = (localStorage.getItem('planning_api_token') || '').trim().toUpperCase();
            const serverToken = msg.config.apiToken.trim().toUpperCase();
            if (savedToken && savedToken !== serverToken) {
              localStorage.removeItem(STORAGE_KEY_TOKEN_VALIDATED);
              setIsTokenValidated(false);
              setTokenRevokedMessage("La clé d'accès a été modifiée par l'administrateur. Veuillez saisir la nouvelle clé.");
            }
          }
        }
      } else if (msg.type === 'NOTES_UPDATED') {
        if (msg.monthKey === selectedMonth) {
          loadTeamSchedule(selectedMonth, employees);
          if (currentEmployee) loadMySchedule(currentEmployee.name, selectedMonth);
        }
      } else if (msg.type === 'STORE_RESET') {
        fetchConfig().then((cfg) => {
          if (cfg) {
            setEmployees(ensureResponsableAdmin(cfg.employees));
            setVisibleMonths(cfg.visibleMonths);
            setAllMonths(cfg.allMonths);
          }
        });
        setTeamSchedules({});
        setMySchedule(null);
      }
    },
    [selectedMonth, currentEmployee, employees, loadTeamSchedule, loadMySchedule]
  );

  const { isConnected: isRealtimeConnected } = useRealtimeSync(handleRealtimeMessage);

  // Check for updates/changes
  const checkEmployeeChanges = useCallback(async (empName: string) => {
    if (!empName) return;
    try {
      const changes = await fetchChanges(empName);
      if (changes && changes.length > 0) {
        setChangesList(changes);
        setIsChangesModalOpen(true);
      }
    } catch {
      // ignore
    }
  }, []);

  // Trigger loads on state change
  useEffect(() => {
    if (!isTokenValidated) return;

    if (activeTab === 'my-planning' && currentEmployee) {
      loadMySchedule(currentEmployee.name, selectedMonth);
      checkEmployeeChanges(currentEmployee.name);
    } else if (activeTab === 'team-planning' || activeTab === 'hours-analytics') {
      loadTeamSchedule(selectedMonth, employees);
    }
  }, [
    isTokenValidated,
    activeTab,
    currentEmployee?.name,
    selectedMonth,
    loadMySchedule,
    loadTeamSchedule,
    checkEmployeeChanges,
  ]);

  // Full Refresh
  const handleManualRefresh = () => {
    loadTeamSchedule(selectedMonth, employees);
    fetchAllSchedules();
    if (currentEmployee) {
      loadMySchedule(currentEmployee.name, selectedMonth);
      checkEmployeeChanges(currentEmployee.name);
    }
  };

  // Open History
  const handleOpenHistory = async () => {
    if (!currentEmployee) return;
    setIsHistoryModalOpen(true);
    setIsLoadingHistory(true);
    try {
      const history = await fetchHistory(currentEmployee.name);
      setHistoryList(history);
    } finally {
      setIsLoadingHistory(false);
    }
  };

  // Acknowledge changes
  const handleAcknowledgeChanges = async () => {
    if (currentEmployee) {
      await clearChanges(currentEmployee.name);
    }
    setChangesList([]);
    setIsChangesModalOpen(false);
  };

  // Handle schedule shift update
  const handleShiftUpdated = (
    employeeName: string,
    dateKey: string,
    shift: string,
    hours: string
  ) => {
    setTeamSchedules((prev) => {
      const copy = { ...prev };
      if (copy[employeeName]) {
        const empSched = { ...copy[employeeName] };
        empSched.days = { ...empSched.days, [dateKey]: { shift, hours } };
        copy[employeeName] = empSched;
      }
      return copy;
    });

    if (currentEmployee && currentEmployee.name.toLowerCase() === employeeName.toLowerCase()) {
      setMySchedule((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          days: { ...prev.days, [dateKey]: { shift, hours } },
        };
      });
    }
  };

  // Handle planning imported directly from Excel (.xlsx)
  const handlePlanningImported = (
    monthKey: string,
    importedTeamSchedules: Record<string, EmployeeMonthSchedule>,
    updatedEmployees?: Employee[]
  ) => {
    if (updatedEmployees && updatedEmployees.length > 0) {
      setEmployees(ensureResponsableAdmin(updatedEmployees));
    }
    setTeamSchedules(importedTeamSchedules);
    if (currentEmployee && importedTeamSchedules[currentEmployee.name]) {
      setMySchedule(importedTeamSchedules[currentEmployee.name]);
    }
    setSelectedMonth(monthKey);
    localStorage.setItem(STORAGE_KEY_MONTH, monthKey);
  };

  // Handlers for dynamic employee and month updates from Admin
  const handleUpdateEmployees = (newEmployees: Employee[]) => {
    const sanitized = ensureResponsableAdmin(newEmployees);
    setEmployees(sanitized);
    if (
      currentEmployee &&
      !sanitized.some((e: Employee) => e.name.toLowerCase() === currentEmployee.name.toLowerCase())
    ) {
      const fallback = sanitized[0] || null;
      setCurrentEmployee(fallback);
      if (fallback) {
        localStorage.setItem(STORAGE_KEY_EMPLOYEE, fallback.name);
      }
    } else if (currentEmployee) {
      const updatedCurrent = sanitized.find((e: Employee) => e.name.toLowerCase() === currentEmployee.name.toLowerCase());
      if (updatedCurrent) {
        setCurrentEmployee(updatedCurrent);
      }
    }
  };

  const handleUpdateAllMonths = (newAllMonths: MonthItem[]) => {
    setAllMonths(newAllMonths);
    if (!newAllMonths.some((m) => m.key === selectedMonth)) {
      const fallbackMonth = newAllMonths[0]?.key || '2026-09';
      setSelectedMonth(fallbackMonth);
      localStorage.setItem(STORAGE_KEY_MONTH, fallbackMonth);
    }
  };

  const handleUpdateVisibleMonths = (newVisibleMonths: string[]) => {
    setVisibleMonths(newVisibleMonths);
    if (!newVisibleMonths.includes(selectedMonth) && newVisibleMonths.length > 0) {
      setSelectedMonth(newVisibleMonths[0]);
      localStorage.setItem(STORAGE_KEY_MONTH, newVisibleMonths[0]);
    }
  };

  // 1. Mandatory Token Gate Screen
  if (!isTokenValidated) {
    return (
      <TokenGate
        infoMessage={tokenRevokedMessage}
        onTokenSuccess={handleTokenSuccess}
      />
    );
  }

  // 2. Main App Screen once token is validated
  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex flex-col antialiased text-slate-900 dark:text-slate-100 transition-colors duration-150 relative">
      {/* PWA Banner */}
      <PWAInstallBanner />

      {/* Main App Header */}
      <Header
        storeName={storeName}
        currentEmployee={currentEmployee}
        onOpenProfileSelector={() => setIsProfileModalOpen(true)}
        onRefresh={handleManualRefresh}
        isSyncing={isSyncing}
        lastSyncTime={lastSyncTime}
        isRealtimeConnected={isRealtimeConnected}
      />

      {/* Offline Status Alert Banner */}
      {(!isOnline || isDataOffline) && (
        <div className="bg-amber-500 text-amber-950 px-4 py-1.5 text-xs font-semibold flex items-center justify-center gap-1.5 shadow-xs">
          <WifiOff className="w-3.5 h-3.5" />
          <span>Mode Hors-ligne : affichage des données en cache local</span>
        </div>
      )}

      {/* Main Content Viewport */}
      <main className="flex-1 max-w-5xl w-full mx-auto p-4 pb-24">
        {activeTab === 'my-planning' ? (
          currentEmployee ? (
            <EmployeeView
              currentEmployee={currentEmployee}
              schedule={mySchedule}
              isLoading={isLoadingMySchedule}
              selectedMonth={selectedMonth}
              allMonths={allMonths}
              visibleMonths={visibleMonths}
              onSelectMonth={handleSelectMonth}
              onRefresh={handleManualRefresh}
              onOpenHistory={handleOpenHistory}
            />
          ) : (
            <div className="bg-slate-900/90 rounded-2xl border border-slate-800 p-8 text-center space-y-4 max-w-sm mx-auto my-12 text-slate-100 shadow-xl">
              <div className="w-12 h-12 rounded-full bg-emerald-950/80 border border-emerald-500/30 text-emerald-400 flex items-center justify-center mx-auto">
                <UserCheck className="w-6 h-6" />
              </div>
              <h3 className="text-base font-bold text-white">Bienvenue sur CanoShift</h3>
              <p className="text-xs text-slate-400">
                Veuillez sélectionner votre profil employé pour commencer.
              </p>
              <button
                onClick={() => setIsProfileModalOpen(true)}
                className="w-full py-2.5 px-4 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-500 rounded-xl transition-colors shadow-xs"
              >
                Choisir mon profil
              </button>
            </div>
          )
        ) : activeTab === 'team-planning' ? (
          <TeamView
            employees={employees}
            currentEmployee={currentEmployee}
            teamSchedules={teamSchedules}
            isLoading={isLoadingTeam}
            selectedMonth={selectedMonth}
            allMonths={allMonths}
            visibleMonths={visibleMonths}
            isAdminActive={isAdminActive}
            onSetAdminActive={setIsAdminActive}
            onSelectMonth={handleSelectMonth}
            onRefresh={handleManualRefresh}
            onShiftUpdated={handleShiftUpdated}
            onNavigateToAdmin={() => setActiveTab('admin')}
          />
        ) : activeTab === 'hours-analytics' ? (
          <HoursAnalyticsView
            employees={employees}
            currentEmployee={currentEmployee}
            teamSchedules={teamSchedules}
            mySchedule={mySchedule}
            selectedMonth={selectedMonth}
            allMonths={allMonths}
            visibleMonths={visibleMonths}
            onSelectMonth={handleSelectMonth}
            onRefresh={handleManualRefresh}
          />
        ) : (
          <AdminView
            currentEmployee={currentEmployee}
            employees={employees}
            allMonths={allMonths}
            visibleMonths={visibleMonths}
            teamSchedules={teamSchedules}
            isAdminActive={isAdminActive}
            onSetAdminActive={setIsAdminActive}
            onUpdateEmployees={handleUpdateEmployees}
            onUpdateVisibleMonths={handleUpdateVisibleMonths}
            onUpdateAllMonths={handleUpdateAllMonths}
                        onPlanningImported={handlePlanningImported}
            onBackToPlanning={() => setActiveTab('my-planning')}
          />
        )}

        {/* Logo de marque centré et visible en bas de chaque vue */}
        <BrandFooter className="mt-8" />
      </main>

      {/* Bottom Navigation */}
      <BottomNav
        activeTab={activeTab}
        onChangeTab={setActiveTab}
        showAdminTab={true}
      />

      {/* Profile Selector Modal */}
      <ProfileSelectorModal
        isOpen={isProfileModalOpen}
        onClose={() => setIsProfileModalOpen(false)}
        employees={employees}
        currentEmployee={currentEmployee}
        onSelectEmployee={handleSelectEmployee}
        onLockToTokenGate={handleLockToTokenGate}
      />

      {/* Changes Detected Alert Modal */}
      <ChangesModal
        isOpen={isChangesModalOpen}
        changes={changesList}
        employeeName={currentEmployee?.name || ''}
        onClose={() => setIsChangesModalOpen(false)}
        onAcknowledge={handleAcknowledgeChanges}
      />

      {/* Modification History Modal */}
      <HistoryModal
        isOpen={isHistoryModalOpen}
        onClose={() => setIsHistoryModalOpen(false)}
        employeeName={currentEmployee?.name || ''}
        history={historyList}
        isLoading={isLoadingHistory}
      />
    </div>
  );
}
