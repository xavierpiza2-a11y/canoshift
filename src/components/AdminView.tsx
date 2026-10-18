import React, { useState, useEffect } from 'react';
import {
  Employee,
  MonthItem,
  Tableau2ShiftOption,
  EmployeeMonthSchedule,
  ContractType,
  HistoryEntry,
} from '../types/planning';
import {
  DEFAULT_ADMIN_PIN,
  DEFAULT_API_TOKEN,
  DEFAULT_TABLEAU2_SHIFTS,
  DEFAULT_STORE_NAME,
  DEFAULT_EMPLOYEES,
} from '../config/constants';
import {
  getApiToken,
  setApiToken,
  saveApiToken,
  getStoredAdminPin,
  setStoredAdminPin,
  saveAdminPin,
  verifyAdminPin,
  saveEmployees,
  saveVisibleMonths,
  saveAllMonths,
  deleteMonthData,
  getCalendarDaysForMonth,
  fetchAvailableShifts,
  updateShiftInSheet,
  getStoredTableau2Shifts,
  renameEmployeeData,
  ensureResponsableAdmin,
  saveStoreName,
  getStoreName,
  resetToCleanStore,
  getStoredDayNotes,
  fetchAllHistory,
  deleteAllHistory,
  deleteEmployeeHistory,
} from '../services/api';
import { exportTeamPlanningToPDF } from '../services/pdfExport';
import { calculateEmployeeBalances, simulateShiftImpact, getMonthWorkingCalendar } from '../services/hoursService';
import { AdminExcelSection } from './AdminExcelSection';
import { AdminTableau2Section } from './AdminTableau2Section';
import { AdminDatabaseSection } from './AdminDatabaseSection';
import {
  ShieldCheck,
  ShieldAlert,
  KeyRound,
  Scale,
  Users,
  Calendar,
  Settings,
  Code2,
  Trash2,
  Plus,
  RefreshCw,
  Check,
  Copy,
  Activity,
  ArrowUp,
  ArrowDown,
  Lock,
  LockKeyhole,
  Clock,
  Download,
  Edit3,
  FileSpreadsheet,
  Sun,
  Sunset,
  Briefcase,
  Home,
  GraduationCap,
  Sparkles,
  AlertTriangle,
  X,
  CalendarDays,
  CheckCircle2,
  Info,
  History,
  Search,
  Filter,
} from 'lucide-react';

export { getStoredAdminPin, setStoredAdminPin };

// Helpers for Month formatting & calendar metadata
export const getFrenchMonthLabel = (key: string): string => {
  const [yStr, mStr] = (key || '').split('-');
  const y = parseInt(yStr, 10);
  const m = parseInt(mStr, 10);
  if (isNaN(y) || isNaN(m) || m < 1 || m > 12) return key;
  const d = new Date(y, m - 1, 1);
  const monthName = d.toLocaleDateString('fr-FR', { month: 'long' });
  const capitalized = monthName.charAt(0).toUpperCase() + monthName.slice(1);
  return `${capitalized} ${y}`;
};

export const getExcelTabLabel = (key: string): string => {
  const [yStr, mStr] = (key || '').split('-');
  const y = parseInt(yStr, 10);
  const m = parseInt(mStr, 10);
  if (isNaN(y) || isNaN(m) || m < 1 || m > 12) return key;
  const d = new Date(y, m - 1, 1);
  const monthName = d.toLocaleDateString('fr-FR', { month: 'long' }).toUpperCase();
  const shortYear = String(y).slice(-2);
  return `${monthName} ${shortYear}`;
};

export const getMonthCalendarSummary = (key: string): string => {
  const [yStr, mStr] = (key || '').split('-');
  const y = parseInt(yStr, 10);
  const m = parseInt(mStr, 10);
  if (isNaN(y) || isNaN(m) || m < 1 || m > 12) return '';
  const daysInMonth = new Date(y, m, 0).getDate();
  const firstDay = new Date(y, m - 1, 1).toLocaleDateString('fr-FR', { weekday: 'long' });
  const lastDay = new Date(y, m - 1, daysInMonth).toLocaleDateString('fr-FR', { weekday: 'long' });
  return `${daysInMonth} jours (du ${firstDay} 1er au ${lastDay} ${daysInMonth})`;
};

interface AdminViewProps {
  storeName?: string;
  onUpdateStoreName?: (name: string) => void;
  currentEmployee?: Employee | null;
  employees: Employee[];
  allMonths: MonthItem[];
  visibleMonths: string[];
  teamSchedules?: Record<string, any>;
  isAdminActive?: boolean;
  onSetAdminActive?: (active: boolean) => void;
  onUpdateEmployees: (employees: Employee[]) => void;
  onUpdateVisibleMonths: (months: string[]) => void;
  onUpdateAllMonths?: (months: MonthItem[]) => void;
  onSwitchToProfile?: (emp: Employee) => void;
  onShiftUpdated?: (employeeName: string, dateKey: string, shift: string, hours: string) => void;
  onPlanningImported?: (
    monthKey: string,
    teamSchedules: Record<string, any>,
    updatedEmployees?: Employee[]
  ) => void;
  onBackToPlanning?: () => void;
}

export const AdminView: React.FC<AdminViewProps> = ({
  storeName,
  onUpdateStoreName,
  currentEmployee,
  employees,
  allMonths,
  visibleMonths,
  teamSchedules,
  isAdminActive,
  onSetAdminActive,
  onUpdateEmployees,
  onUpdateVisibleMonths,
  onUpdateAllMonths,
  onSwitchToProfile,
  onShiftUpdated,
  onPlanningImported,
  onBackToPlanning,
}) => {
  // Authentication state
  const [localAuth, setLocalAuth] = useState(false);
  const isAuthenticated = isAdminActive !== undefined ? isAdminActive : localAuth;
  const setAuth = (val: boolean) => {
    setLocalAuth(val);
    onSetAdminActive?.(val);
  };
  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState('');

  // Active Admin Sub-tab: Default to Excel tab as requested
  const [adminTab, setAdminTab] = useState<
    'excel' | 'shifts_reference' | 'shifts' | 'team' | 'months' | 'history' | 'connection'
  >('excel');

  // Shifts Direct Modification State (Strictly Tableau 2 choices)
  const [shiftEditMonth, setShiftEditMonth] = useState<string>(
    visibleMonths[0] || allMonths[0]?.key || '2026-09'
  );
  const [shiftEditEmployee, setShiftEditEmployee] = useState<string>(
    employees[0]?.name || ''
  );
  const [shiftEditDate, setShiftEditDate] = useState<string>(
    () => `${visibleMonths[0] || '2026-09'}-01`
  );
  const [shiftEditOptionId, setShiftEditOptionId] = useState<string>('repos');
  const [tableau2Options, setTableau2Options] = useState<Tableau2ShiftOption[]>(
    getStoredTableau2Shifts
  );
  const [isUpdatingShift, setIsUpdatingShift] = useState(false);
  const [shiftUpdateStatus, setShiftUpdateStatus] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);
  const [isExportingTeamPdf, setIsExportingTeamPdf] = useState(false);

  // Global Admin Toast notification
  const [adminToast, setAdminToast] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  const showToast = (type: 'success' | 'error', text: string) => {
    setAdminToast({ type, text });
    setTimeout(() => setAdminToast(null), 3500);
  };

  // Store Reset modal state
  const [isResetStoreModalOpen, setIsResetStoreModalOpen] = useState(false);
  const [resetStoreInput, setResetStoreInput] = useState('');

  const handleConfirmResetStore = () => {
    const finalName = resetStoreInput.trim() || storeName || DEFAULT_STORE_NAME;
    resetToCleanStore(finalName);
    onUpdateStoreName?.(finalName);
    setTeamList(DEFAULT_EMPLOYEES);
    onUpdateEmployees(DEFAULT_EMPLOYEES);
    setIsResetStoreModalOpen(false);
    setResetStoreInput('');
    showToast('success', `Application réinitialisée pour « ${finalName} ». Données vierges prêtes !`);
  };

  // Admin PIN Modification State
  const [newAdminPin, setNewAdminPin] = useState('');
  const [confirmAdminPin, setConfirmAdminPin] = useState('');
  const [adminPinSuccess, setAdminPinSuccess] = useState(false);
  const [adminPinError, setAdminPinError] = useState('');

  // Security Token state
  const [tokenInput, setTokenInput] = useState(getApiToken());
  const [connectionSuccess, setConnectionSuccess] = useState(false);

  // Team management state
  const [teamList, setTeamList] = useState<Employee[]>(employees);
  const [isSavingTeam, setIsSavingTeam] = useState(false);
  const [teamSavedSuccess, setTeamSavedSuccess] = useState(false);
  const [newEmpName, setNewEmpName] = useState('');
  const [newEmpRole, setNewEmpRole] = useState('');
  const [newEmpIsAdmin, setNewEmpIsAdmin] = useState(false);
  const [newEmpColor, setNewEmpColor] = useState('#166534');
  const [newEmpContractType, setNewEmpContractType] = useState<ContractType>('HEBDO_35H');
  const [newEmpWeeklyQuota, setNewEmpWeeklyQuota] = useState<number>(35);
  const [newEmpYearlyQuota, setNewEmpYearlyQuota] = useState<number>(1607);
  const [newEmpForfaitDaysQuota, setNewEmpForfaitDaysQuota] = useState<number>(218);
  const [newEmpInitialHoursBalance, setNewEmpInitialHoursBalance] = useState<number>(0);
  const [newEmpPaidLeaveTotal, setNewEmpPaidLeaveTotal] = useState<number>(25);
  const [newEmpPaidLeaveTaken, setNewEmpPaidLeaveTaken] = useState<number>(0);
  const [newEmpRttTotal, setNewEmpRttTotal] = useState<number>(0);
  const [newEmpRttTaken, setNewEmpRttTaken] = useState<number>(0);
  const [employeeToDelete, setEmployeeToDelete] = useState<Employee | null>(null);

  // Employee modification state
  const [employeeToEdit, setEmployeeToEdit] = useState<Employee | null>(null);
  const [editEmpName, setEditEmpName] = useState('');
  const [editEmpRole, setEditEmpRole] = useState('');
  const [editEmpIsAdmin, setEditEmpIsAdmin] = useState(false);
  const [editEmpColor, setEditEmpColor] = useState('#166534');
  const [editEmpContractType, setEditEmpContractType] = useState<ContractType>('HEBDO_35H');
  const [editEmpWeeklyQuota, setEditEmpWeeklyQuota] = useState<number>(35);
  const [editEmpYearlyQuota, setEditEmpYearlyQuota] = useState<number>(1607);
  const [editEmpForfaitDaysQuota, setEditEmpForfaitDaysQuota] = useState<number>(218);
  const [editEmpInitialHoursBalance, setEditEmpInitialHoursBalance] = useState<number>(0);
  const [editEmpPaidLeaveTotal, setEditEmpPaidLeaveTotal] = useState<number>(25);
  const [editEmpPaidLeaveTaken, setEditEmpPaidLeaveTaken] = useState<number>(0);
  const [editEmpRttTotal, setEditEmpRttTotal] = useState<number>(0);
  const [editEmpRttTaken, setEditEmpRttTaken] = useState<number>(0);

  // Months management state
  const [monthsList, setMonthsList] = useState<MonthItem[]>(allMonths);
  const [selectedVisibleMonths, setSelectedVisibleMonths] = useState<string[]>(visibleMonths);
  const [isSavingMonths, setIsSavingMonths] = useState(false);
  const [monthsSavedSuccess, setMonthsSavedSuccess] = useState(false);

  // New month creation form
  const [newMonthPickerVal, setNewMonthPickerVal] = useState<string>('2026-11');
  const [newMonthLabel, setNewMonthLabel] = useState<string>('Novembre 2026');
  const [newMonthTab, setNewMonthTab] = useState<string>('NOVEMBRE 26');

  // Month modification state
  const [monthToEdit, setMonthToEdit] = useState<MonthItem | null>(null);
  const [editMonthKey, setEditMonthKey] = useState<string>('');
  const [editMonthLabel, setEditMonthLabel] = useState<string>('');
  const [editMonthTab, setEditMonthTab] = useState<string>('');
  const [editMonthCustomWorkingDays, setEditMonthCustomWorkingDays] = useState<string>('');
  const [editMonthCustomBaseHours, setEditMonthCustomBaseHours] = useState<string>('');

  // Month deletion confirmation modal
  const [monthToDelete, setMonthToDelete] = useState<MonthItem | null>(null);

  // Modification History Management State (Option A - 2 Niveaux)
  const [historyRecords, setHistoryRecords] = useState<HistoryEntry[]>([]);
  const [historyTotalCount, setHistoryTotalCount] = useState<number>(0);
  const [historyByEmployee, setHistoryByEmployee] = useState<Record<string, number>>({});
  const [isLoadingHistory, setIsLoadingHistory] = useState<boolean>(false);
  const [historyFilterEmployee, setHistoryFilterEmployee] = useState<string>('all');
  const [historySearchQuery, setHistorySearchQuery] = useState<string>('');
  const [historyEmployeeToDelete, setHistoryEmployeeToDelete] = useState<{ name: string; count: number } | null>(null);
  const [isPurgeAllHistoryModalOpen, setIsPurgeAllHistoryModalOpen] = useState<boolean>(false);
  const [isDeletingHistory, setIsDeletingHistory] = useState<boolean>(false);

  const loadAdminHistory = async () => {
    setIsLoadingHistory(true);
    try {
      const data = await fetchAllHistory();
      setHistoryRecords(data.records || []);
      setHistoryTotalCount(data.count || 0);
      setHistoryByEmployee(data.byEmployee || {});
    } catch (err) {
      console.error('Erreur chargement historique:', err);
    } finally {
      setIsLoadingHistory(false);
    }
  };

  useEffect(() => {
    if (isAuthenticated) {
      loadAdminHistory();
    }
  }, [isAuthenticated, adminTab]);

  const handleConfirmDeleteEmployeeHistory = async () => {
    if (!historyEmployeeToDelete) return;
    setIsDeletingHistory(true);
    try {
      const res = await deleteEmployeeHistory(historyEmployeeToDelete.name);
      if (res.success) {
        showToast('success', `Historique de « ${historyEmployeeToDelete.name} » supprimé (${res.count} entrée${res.count > 1 ? 's' : ''}).`);
        setHistoryEmployeeToDelete(null);
        await loadAdminHistory();
      } else {
        showToast('error', res.error || 'Erreur lors de la suppression');
      }
    } catch (err: any) {
      showToast('error', err.message || 'Erreur');
    } finally {
      setIsDeletingHistory(false);
    }
  };

  const handleConfirmPurgeAllHistory = async () => {
    setIsDeletingHistory(true);
    try {
      const res = await deleteAllHistory();
      if (res.success) {
        showToast('success', `Tout l'historique du magasin a été purgé (${res.count} modification${res.count > 1 ? 's' : ''} effacée${res.count > 1 ? 's' : ''}).`);
        setIsPurgeAllHistoryModalOpen(false);
        await loadAdminHistory();
      } else {
        showToast('error', res.error || 'Erreur lors de la purge');
      }
    } catch (err: any) {
      showToast('error', err.message || 'Erreur');
    } finally {
      setIsDeletingHistory(false);
    }
  };

  const filteredHistory = historyRecords.filter((rec) => {
    if (historyFilterEmployee !== 'all') {
      if ((rec.employee || '').toLowerCase() !== historyFilterEmployee.toLowerCase()) {
        return false;
      }
    }
    if (historySearchQuery.trim()) {
      const q = historySearchQuery.toLowerCase().trim();
      const matchEmp = (rec.employee || '').toLowerCase().includes(q);
      const matchDate = (rec.date || '').toLowerCase().includes(q);
      const matchChange = (rec.change || '').toLowerCase().includes(q);
      if (!matchEmp && !matchDate && !matchChange) {
        return false;
      }
    }
    return true;
  });

  // Sync props to state
  useEffect(() => {
    setTeamList(employees);
  }, [employees]);

  useEffect(() => {
    setMonthsList(allMonths);
  }, [allMonths]);

  useEffect(() => {
    setSelectedVisibleMonths(visibleMonths);
  }, [visibleMonths]);

  // Load available shifts & check push permission on auth
  useEffect(() => {
    if (isAuthenticated) {
      fetchAvailableShifts().then((shifts) => {
        if (shifts && shifts.length > 0) {
          setTableau2Options(shifts);
        }
      });
    }
  }, [isAuthenticated]);

  // Keep shiftEditDate in sync with month
  useEffect(() => {
    if (!shiftEditDate.startsWith(shiftEditMonth)) {
      setShiftEditDate(`${shiftEditMonth}-01`);
    }
  }, [shiftEditMonth]);

  // Update default label & tab when month picker value changes
  const handleMonthPickerChange = (val: string) => {
    setNewMonthPickerVal(val);
    if (val && val.includes('-')) {
      setNewMonthLabel(getFrenchMonthLabel(val));
      setNewMonthTab(getExcelTabLabel(val));
    }
  };

  // Numpad key press handler (6-digit PIN)
  const handleKeypadPress = (val: string) => {
    setPinError('');
    if (val === 'clear') {
      setPinInput('');
      return;
    }
    if (val === 'backspace') {
      setPinInput((prev) => prev.slice(0, -1));
      return;
    }

    if (pinInput.length >= 6) return;

    const nextPin = pinInput + val;
    setPinInput(nextPin);

    // Auto-verify when 6 digits are typed against active stored admin pin
    if (nextPin.length === 6) {
      verifyAdminPin(nextPin).then((isValid) => {
        if (isValid) {
          setTimeout(() => {
            setAuth(true);
            setPinInput('');
            setPinError('');
          }, 150);
        } else {
          setTimeout(() => {
            setPinError('Code PIN incorrect (6 chiffres)');
            setPinInput('');
          }, 250);
        }
      });
    }
  };

  // Submit PIN explicitly: ONLY active stored admin pin
  const handleValidatePin = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const pin = pinInput.trim();
    const isValid = await verifyAdminPin(pin);

    if (isValid) {
      setAuth(true);
      setPinInput('');
      setPinError('');
    } else {
      setPinError('Code PIN incorrect (6 chiffres)');
      setPinInput('');
    }
  };

  // Change Admin PIN: strictly 6 digits
  const handleChangeAdminPin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAdminPinError('');
    setAdminPinSuccess(false);

    const pin = newAdminPin.trim();
    if (pin.length !== 6 || !/^\d{6}$/.test(pin)) {
      setAdminPinError('Le code PIN doit comporter exactement 6 chiffres.');
      return;
    }

    if (pin !== confirmAdminPin.trim()) {
      setAdminPinError('Les deux codes PIN ne correspondent pas.');
      return;
    }

    await saveAdminPin(pin);
    setAdminPinSuccess(true);
    setNewAdminPin('');
    setConfirmAdminPin('');
    showToast('success', 'Nouveau code PIN enregistré sur la base de données !');
    setTimeout(() => setAdminPinSuccess(false), 3000);
  };

  // Save Security Token
  const handleSaveConnection = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanToken = tokenInput.trim();
    await saveApiToken(cleanToken);
    setConnectionSuccess(true);
    showToast('success', 'Jeton d’accès enregistré sur la base de données !');
    setTimeout(() => setConnectionSuccess(false), 3000);
  };

  // --- TEAM MANAGEMENT HANDLERS ---
  const handleAddEmployee = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newEmpName.trim();
    if (!trimmed) return;

    if (teamList.some((emp) => emp.name.toLowerCase() === trimmed.toLowerCase())) {
      showToast('error', `Un salarié nommé « ${trimmed} » existe déjà.`);
      return;
    }

    const isResp = Boolean(
      (newEmpRole && newEmpRole.trim().toLowerCase().includes('responsable')) ||
      trimmed.toLowerCase() === 'responsable'
    );
    const newEmp: Employee = {
      name: trimmed,
      color: newEmpColor,
      role: newEmpRole.trim() || (isResp ? 'Responsable' : 'Collaborateur'),
      isAdmin: isResp ? true : newEmpIsAdmin,
      contractType: newEmpContractType,
      weeklyHoursQuota: newEmpWeeklyQuota,
      yearlyHoursQuota: newEmpYearlyQuota,
      forfaitDaysQuota: newEmpForfaitDaysQuota,
      initialHoursBalance: newEmpInitialHoursBalance,
      paidLeaveTotal: newEmpPaidLeaveTotal,
      paidLeaveTaken: newEmpPaidLeaveTaken,
      rttTotal: newEmpRttTotal,
      rttTaken: newEmpRttTaken,
    };

    const updated = ensureResponsableAdmin([...teamList, newEmp]);
    setTeamList(updated);
    setNewEmpName('');
    setNewEmpRole('');
    setNewEmpIsAdmin(false);
    setNewEmpContractType('HEBDO_35H');
    setNewEmpWeeklyQuota(35);
    setNewEmpYearlyQuota(1607);
    setNewEmpForfaitDaysQuota(218);
    setNewEmpInitialHoursBalance(0);
    setNewEmpPaidLeaveTotal(25);
    setNewEmpPaidLeaveTaken(0);
    setNewEmpRttTotal(0);
    setNewEmpRttTaken(0);

    // Auto-save and sync immediately with application state
    await saveEmployees(updated);
    onUpdateEmployees(updated);
    showToast('success', `Salarié « ${trimmed} » ajouté avec succès.`);
  };

  const handleStartEditEmployee = (emp: Employee) => {
    setEmployeeToEdit(emp);
    setEditEmpName(emp.name);
    setEditEmpRole(emp.role || '');
    const isResp = Boolean(
      (emp.role && emp.role.trim().toLowerCase().includes('responsable')) ||
      emp.name.trim().toLowerCase() === 'responsable'
    );
    setEditEmpIsAdmin(isResp ? true : Boolean(emp.isAdmin));
    setEditEmpColor(emp.color || '#166534');
    setEditEmpContractType(emp.contractType || 'HEBDO_35H');
    setEditEmpWeeklyQuota(emp.weeklyHoursQuota ?? 35);
    setEditEmpYearlyQuota(emp.yearlyHoursQuota ?? 1607);
    setEditEmpForfaitDaysQuota(emp.forfaitDaysQuota ?? 218);
    setEditEmpInitialHoursBalance(emp.initialHoursBalance ?? 0);
    setEditEmpPaidLeaveTotal(emp.paidLeaveTotal ?? 25);
    setEditEmpPaidLeaveTaken(emp.paidLeaveTaken ?? 0);
    setEditEmpRttTotal(emp.rttTotal ?? (emp.contractType === 'FORFAIT_JOUR' ? 10 : 0));
    setEditEmpRttTaken(emp.rttTaken ?? 0);
  };

  const handleSaveEditEmployee = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!employeeToEdit) return;
    const oldName = employeeToEdit.name;
    const newName = editEmpName.trim();
    if (!newName) {
      showToast('error', 'Le nom du salarié ne peut pas être vide.');
      return;
    }

    if (
      teamList.some(
        (emp) =>
          emp.name.toLowerCase() === newName.toLowerCase() &&
          emp.name.toLowerCase() !== oldName.toLowerCase()
      )
    ) {
      showToast('error', `Un salarié nommé « ${newName} » existe déjà.`);
      return;
    }

    // Safely migrate all schedules if renamed
    if (oldName !== newName) {
      renameEmployeeData(oldName, newName);
    }

    const isResp = Boolean(
      (employeeToEdit.role && employeeToEdit.role.trim().toLowerCase().includes('responsable')) ||
      oldName.toLowerCase() === 'responsable' ||
      newName.toLowerCase() === 'responsable'
    );
    const finalRole = isResp ? 'Responsable' : editEmpRole.trim();
    const finalIsAdmin = isResp ? true : editEmpIsAdmin;

    const mapped = teamList.map((emp) => {
      if (emp.name === oldName) {
        return {
          ...emp,
          name: newName,
          role: finalRole,
          isAdmin: finalIsAdmin,
          color: editEmpColor,
          contractType: editEmpContractType,
          weeklyHoursQuota: editEmpWeeklyQuota,
          yearlyHoursQuota: editEmpYearlyQuota,
          forfaitDaysQuota: editEmpForfaitDaysQuota,
          initialHoursBalance: editEmpInitialHoursBalance,
          paidLeaveTotal: editEmpPaidLeaveTotal,
          paidLeaveTaken: editEmpPaidLeaveTaken,
          rttTotal: editEmpRttTotal,
          rttTaken: editEmpRttTaken,
        };
      }
      return emp;
    });

    const updated = ensureResponsableAdmin(mapped);

    setTeamList(updated);
    setEmployeeToEdit(null);
    await saveEmployees(updated);
    onUpdateEmployees(updated);
    showToast('success', `Salarié « ${newName} » mis à jour avec succès.`);
  };

  const handleRequestDeleteEmployee = (emp: Employee) => {
    const isResp = Boolean(
      (emp.role && emp.role.trim().toLowerCase().includes('responsable')) ||
      emp.name.trim().toLowerCase() === 'responsable'
    );
    if (isResp) {
      showToast('error', "Le Responsable est l'administrateur de l'équipe et ne peut pas être supprimé.");
      return;
    }

    if (teamList.length <= 1) {
      showToast('error', 'Vous devez conserver au moins un salarié dans l’équipe.');
      return;
    }
    setEmployeeToDelete(emp);
  };

  const handleConfirmDeleteEmployee = async () => {
    if (!employeeToDelete) return;
    const name = employeeToDelete.name;

    const updated = ensureResponsableAdmin(teamList.filter((e) => e.name !== name));
    setTeamList(updated);
    setEmployeeToDelete(null);

    // Auto-save and sync immediately with application state
    await saveEmployees(updated);
    onUpdateEmployees(updated);
    showToast('success', `Salarié « ${name} » supprimé de l'équipe.`);
  };

  const handleMoveEmployee = async (index: number, direction: 'up' | 'down') => {
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= teamList.length) return;

    const list = [...teamList];
    const [moved] = list.splice(index, 1);
    list.splice(targetIndex, 0, moved);
    setTeamList(list);

    // Auto-save
    await saveEmployees(list);
    onUpdateEmployees(list);
  };

  const handleUpdateEmployeeColor = async (index: number, newColor: string) => {
    const list = [...teamList];
    list[index] = { ...list[index], color: newColor };
    setTeamList(list);

    // Auto-save
    await saveEmployees(list);
    onUpdateEmployees(list);
  };

  const handleSaveTeamToBackend = async () => {
    setIsSavingTeam(true);
    await saveEmployees(teamList);
    setIsSavingTeam(false);
    onUpdateEmployees(teamList);
    setTeamSavedSuccess(true);
    setTimeout(() => setTeamSavedSuccess(false), 3000);
    showToast('success', "Équipe enregistrée avec succès.");
  };

  // --- MONTH MANAGEMENT HANDLERS ---
  const handleToggleMonthVisibility = async (key: string) => {
    let nextVisible: string[];
    if (selectedVisibleMonths.includes(key)) {
      if (selectedVisibleMonths.length <= 1) {
        showToast('error', 'Au moins un mois doit rester visible dans le planning.');
        return;
      }
      nextVisible = selectedVisibleMonths.filter((m) => m !== key);
    } else {
      nextVisible = [...selectedVisibleMonths, key];
    }

    setSelectedVisibleMonths(nextVisible);
    await saveVisibleMonths(nextVisible);
    onUpdateVisibleMonths(nextVisible);
  };

  // Add a new Month with calendar days verified
  const handleAddMonth = async (e: React.FormEvent) => {
    e.preventDefault();
    const key = newMonthPickerVal.trim();
    const label = newMonthLabel.trim() || getFrenchMonthLabel(key);
    const tab = newMonthTab.trim().toUpperCase() || getExcelTabLabel(key);

    if (!key || !key.match(/^\d{4}-\d{2}$/)) {
      showToast('error', 'Le format du mois doit être AAAA-MM (ex: 2026-11).');
      return;
    }

    if (monthsList.some((m) => m.key === key)) {
      showToast('error', `Le mois « ${key} » existe déjà dans la liste.`);
      return;
    }

    const newMonthItem: MonthItem = { key, label, tab };
    const updatedMonths = [...monthsList, newMonthItem];
    const updatedVisible = selectedVisibleMonths.includes(key)
      ? selectedVisibleMonths
      : [...selectedVisibleMonths, key];

    setMonthsList(updatedMonths);
    setSelectedVisibleMonths(updatedVisible);

    // Persist to storage & sync with root App state
    await saveAllMonths(updatedMonths);
    await saveVisibleMonths(updatedVisible);
    onUpdateAllMonths?.(updatedMonths);
    onUpdateVisibleMonths(updatedVisible);

    const daysCount = getCalendarDaysForMonth(key).length;
    showToast('success', `Mois « ${label} » créé avec succès (${daysCount} dates du calendrier).`);
  };

  // Start Edit Month
  const handleStartEditMonth = (m: MonthItem) => {
    setMonthToEdit(m);
    setEditMonthKey(m.key);
    setEditMonthLabel(m.label);
    setEditMonthTab(m.tab);
    setEditMonthCustomWorkingDays(
      typeof m.customWorkingDays === 'number' ? String(m.customWorkingDays) : ''
    );
    setEditMonthCustomBaseHours(
      typeof m.customBaseHours === 'number' ? String(m.customBaseHours) : ''
    );
  };

  // Save Edit Month
  const handleSaveEditMonth = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!monthToEdit) return;

    const oldKey = monthToEdit.key;
    const newKey = editMonthKey.trim();
    const newLabel = editMonthLabel.trim() || getFrenchMonthLabel(newKey);
    const newTab = editMonthTab.trim().toUpperCase() || getExcelTabLabel(newKey);

    if (!newKey || !newKey.match(/^\d{4}-\d{2}$/)) {
      showToast('error', 'Le format du mois doit être AAAA-MM (ex: 2026-11).');
      return;
    }

    if (newKey !== oldKey && monthsList.some((m) => m.key === newKey)) {
      showToast('error', `Le mois « ${newKey} » existe déjà.`);
      return;
    }

    const parsedWorkingDays = editMonthCustomWorkingDays.trim() !== ''
      ? Math.max(0, parseInt(editMonthCustomWorkingDays.trim(), 10))
      : undefined;

    const parsedBaseHours = editMonthCustomBaseHours.trim() !== ''
      ? Math.max(0, parseFloat(editMonthCustomBaseHours.trim().replace(',', '.')))
      : undefined;

    const updatedMonths: MonthItem[] = monthsList.map((m) =>
      m.key === oldKey
        ? {
            key: newKey,
            label: newLabel,
            tab: newTab,
            customWorkingDays: !isNaN(parsedWorkingDays as number) ? parsedWorkingDays : undefined,
            customBaseHours: !isNaN(parsedBaseHours as number) ? parsedBaseHours : undefined,
          }
        : m
    );

    let updatedVisible = selectedVisibleMonths;
    if (newKey !== oldKey) {
      updatedVisible = selectedVisibleMonths.map((k) => (k === oldKey ? newKey : k));
    }

    setMonthsList(updatedMonths);
    setSelectedVisibleMonths(updatedVisible);
    setMonthToEdit(null);

    await saveAllMonths(updatedMonths);
    await saveVisibleMonths(updatedVisible);
    onUpdateAllMonths?.(updatedMonths);
    onUpdateVisibleMonths(updatedVisible);

    showToast('success', `Mois « ${newLabel} » mis à jour.`);
  };

  // Delete Month
  const handleConfirmDeleteMonth = async () => {
    if (!monthToDelete) return;
    const key = monthToDelete.key;
    const label = monthToDelete.label;

    if (monthsList.length <= 1) {
      showToast('error', "Impossible de supprimer l'unique mois de planning.");
      setMonthToDelete(null);
      return;
    }

    const updatedMonths = monthsList.filter((m) => m.key !== key);
    const updatedVisible = selectedVisibleMonths.filter((m) => m !== key);

    setMonthsList(updatedMonths);
    setSelectedVisibleMonths(updatedVisible);
    deleteMonthData(key);
    setMonthToDelete(null);

    await saveAllMonths(updatedMonths);
    await saveVisibleMonths(updatedVisible);
    onUpdateAllMonths?.(updatedMonths);
    onUpdateVisibleMonths(updatedVisible);

    showToast('success', `Mois « ${label} » supprimé.`);
  };

  const handleSaveMonthsToBackend = async () => {
    setIsSavingMonths(true);
    await saveAllMonths(monthsList);
    await saveVisibleMonths(selectedVisibleMonths);
    setIsSavingMonths(false);
    onUpdateAllMonths?.(monthsList);
    onUpdateVisibleMonths(selectedVisibleMonths);
    setMonthsSavedSuccess(true);
    setTimeout(() => setMonthsSavedSuccess(false), 3000);
    showToast('success', "Configuration des mois sauvegardée.");
  };

  // Direct Shift Modification Handler (Tableau 2)
  const handleDirectShiftUpdate = async () => {
    const selectedOpt = tableau2Options.find((o) => o.id === shiftEditOptionId);
    if (!selectedOpt) {
      setShiftUpdateStatus({ type: 'error', text: 'Veuillez sélectionner un horaire Tableau 2.' });
      return;
    }

    setIsUpdatingShift(true);
    setShiftUpdateStatus(null);

    try {
      const res = await updateShiftInSheet(
        shiftEditMonth,
        shiftEditEmployee,
        shiftEditDate,
        selectedOpt.shift,
        selectedOpt.hours
      );

      if (res.success) {
        setShiftUpdateStatus({
          type: 'success',
          text: `Horaire enregistré avec succès pour ${shiftEditEmployee} le ${shiftEditDate} !`,
        });
        if (onShiftUpdated) {
          onShiftUpdated(shiftEditEmployee, shiftEditDate, selectedOpt.shift, selectedOpt.hours);
        }
      } else {
        setShiftUpdateStatus({ type: 'error', text: res.message });
      }
    } catch (err: any) {
      setShiftUpdateStatus({ type: 'error', text: err.message || 'Erreur lors de la mise à jour.' });
    } finally {
      setIsUpdatingShift(false);
    }
  };

  // PDF Export from Admin
  const handleExportPDF = async () => {
    setIsExportingTeamPdf(true);
    try {
      const monthObj = monthsList.find((m) => m.key === shiftEditMonth);
      await exportTeamPlanningToPDF({
        monthKey: shiftEditMonth,
        monthLabel: monthObj?.label || shiftEditMonth,
        employees,
        teamSchedules: teamSchedules || {},
      });
    } catch (err) {
      console.error(err);
    } finally {
      setIsExportingTeamPdf(false);
    }
  };

  // Check if current user has admin rights
  const isCurrentAdmin = Boolean(
    currentEmployee &&
      (currentEmployee.isAdmin ||
        currentEmployee.name.trim().toLowerCase() === 'responsable' ||
        (currentEmployee.role &&
          currentEmployee.role.trim().toLowerCase().includes('responsable')))
  );

  // If active user is not designated as admin, block access
  if (!isCurrentAdmin) {
    return (
      <div className="max-w-md mx-auto py-12 px-4 animate-in fade-in duration-300">
        <div className="bg-white rounded-3xl border border-slate-200/80 p-6 sm:p-8 shadow-sm text-center space-y-4">
          <div className="w-14 h-14 bg-amber-100 rounded-2xl flex items-center justify-center text-amber-800 mx-auto shadow-inner">
            <ShieldAlert className="w-7 h-7" />
          </div>
          <h2 className="text-xl font-bold text-slate-900 tracking-tight">Accès Administrateur restreint</h2>
          <p className="text-xs text-slate-600 leading-relaxed">
            Seules les personnes désignées comme administrateur par le responsable ont accès à l'espace d'administration.
          </p>
          <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs text-slate-500">
            Profil actif actuel : <strong className="text-slate-800">{currentEmployee ? currentEmployee.name : 'Aucun'}</strong>
          </div>
          {onBackToPlanning && (
            <div className="pt-1">
              <button
                type="button"
                onClick={onBackToPlanning}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-emerald-700 hover:text-emerald-900 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-xl transition-colors cursor-pointer"
              >
                ← Retourner à mon planning
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  // 1. PIN Lock Screen if not authenticated
  if (!isAuthenticated) {
    return (
      <div className="max-w-md mx-auto py-8 px-4 animate-in fade-in duration-300">
        <div className="bg-white rounded-3xl border border-slate-200/80 p-6 sm:p-8 shadow-sm text-center">
          <div className="w-14 h-14 bg-emerald-100 rounded-2xl flex items-center justify-center text-emerald-800 mx-auto mb-4 shadow-inner">
            <Lock className="w-7 h-7" />
          </div>

          <h2 className="text-xl font-bold text-slate-900 tracking-tight">Accès Administrateur</h2>
          <p className="text-xs text-slate-500 mt-1 mb-6">
            Saisissez votre code PIN à 6 chiffres pour déverrouiller la gestion.
          </p>

          <div className="mb-6 flex justify-center gap-3">
            {[0, 1, 2, 3, 4, 5].map((idx) => {
              const isFilled = pinInput.length > idx;
              return (
                <div
                  key={idx}
                  className={`w-4 h-4 rounded-full border-2 transition-all ${
                    isFilled ? 'bg-emerald-600 border-emerald-600 scale-110' : 'border-slate-300 bg-slate-50'
                  }`}
                />
              );
            })}
          </div>

          {pinError && (
            <div className="mb-4 p-2.5 rounded-xl bg-rose-50 text-rose-600 text-xs font-semibold flex items-center justify-center gap-1.5 animate-shake">
              <ShieldAlert className="w-4 h-4 shrink-0" />
              <span>{pinError}</span>
            </div>
          )}

          <div className="grid grid-cols-3 gap-2.5 max-w-[280px] mx-auto mb-4">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9', 'clear', '0', 'backspace'].map((key) => {
              if (key === 'clear') {
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => handleKeypadPress('clear')}
                    className="h-12 rounded-xl text-xs font-bold text-slate-500 hover:bg-slate-100 active:bg-slate-200 transition-colors uppercase tracking-wider"
                  >
                    Effacer
                  </button>
                );
              }
              if (key === 'backspace') {
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => handleKeypadPress('backspace')}
                    className="h-12 rounded-xl flex items-center justify-center text-slate-500 hover:bg-slate-100 active:bg-slate-200 transition-colors"
                  >
                    ⌫
                  </button>
                );
              }
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => handleKeypadPress(key)}
                  className="h-12 rounded-xl bg-slate-50 border border-slate-200/80 text-lg font-bold text-slate-800 hover:bg-emerald-50 hover:border-emerald-300 active:bg-emerald-100 transition-colors shadow-2xs"
                >
                  {key}
                </button>
              );
            })}
          </div>

          <div className="pt-2 border-t border-slate-100 flex items-center justify-end text-[11px] text-slate-400">
            <button
              onClick={() => handleValidatePin()}
              className="font-semibold text-emerald-700 hover:underline"
            >
              Valider
            </button>
          </div>
        </div>
      </div>
    );
  }

  // 2. Authenticated Admin Interface
  return (
    <div className="max-w-4xl mx-auto space-y-4 pb-12 animate-in fade-in duration-200">
      {/* Global Toast Alert */}
      {adminToast && (
        <div
          className={`fixed top-4 right-4 z-50 p-3 rounded-xl shadow-lg border text-xs font-bold flex items-center gap-2 max-w-sm animate-in slide-in-from-top-3 ${
            adminToast.type === 'success'
              ? 'bg-emerald-50 text-emerald-950 border-emerald-300'
              : 'bg-rose-50 text-rose-950 border-rose-300'
          }`}
        >
          {adminToast.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          ) : (
            <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
          )}
          <span>{adminToast.text}</span>
          <button
            onClick={() => setAdminToast(null)}
            className="ml-auto text-slate-400 hover:text-slate-700"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Top Banner with Logout */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-emerald-100 text-emerald-800 flex items-center justify-center font-bold">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-slate-900">Espace Administration</h2>
            <p className="text-xs text-slate-500">
              Gestion de l'équipe, plannings, fichiers Excel et créneaux horaires
            </p>
          </div>
        </div>

        <button
          onClick={() => setAuth(false)}
          className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors"
        >
          Verrouiller
        </button>
      </div>

      {/* Admin Navigation Sub-Tabs */}
      <div className="grid grid-cols-3 sm:grid-cols-7 gap-1 bg-slate-200/70 p-1 rounded-xl text-xs font-semibold">
        <button
          onClick={() => setAdminTab('excel')}
          className={`py-2 px-1 rounded-lg transition-colors flex flex-col sm:flex-row items-center justify-center gap-1.5 text-center ${
            adminTab === 'excel'
              ? 'bg-white text-emerald-950 font-bold shadow-xs border-b-2 border-emerald-600'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" />
          <span className="text-[11px] sm:text-xs">Fichier Excel</span>
        </button>

        <button
          onClick={() => setAdminTab('shifts_reference')}
          className={`py-2 px-1 rounded-lg transition-colors flex flex-col sm:flex-row items-center justify-center gap-1.5 text-center ${
            adminTab === 'shifts_reference'
              ? 'bg-white text-emerald-950 font-bold shadow-xs border-b-2 border-emerald-600'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <Sparkles className="w-3.5 h-3.5 text-amber-600" />
          <span className="text-[11px] sm:text-xs">Créneaux</span>
        </button>

        <button
          onClick={() => setAdminTab('shifts')}
          className={`py-2 px-1 rounded-lg transition-colors flex flex-col sm:flex-row items-center justify-center gap-1.5 text-center ${
            adminTab === 'shifts'
              ? 'bg-white text-emerald-900 font-bold shadow-xs border-b-2 border-emerald-600'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <Clock className="w-3.5 h-3.5 text-emerald-600" />
          <span className="text-[11px] sm:text-xs">Modifier shift</span>
        </button>

        <button
          onClick={() => setAdminTab('team')}
          className={`py-2 px-1 rounded-lg transition-colors flex flex-col sm:flex-row items-center justify-center gap-1.5 text-center ${
            adminTab === 'team'
              ? 'bg-white text-slate-900 font-bold shadow-xs'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <Users className="w-3.5 h-3.5 text-emerald-700" />
          <span className="text-[11px] sm:text-xs">Équipe</span>
        </button>

        <button
          onClick={() => setAdminTab('months')}
          className={`py-2 px-1 rounded-lg transition-colors flex flex-col sm:flex-row items-center justify-center gap-1.5 text-center ${
            adminTab === 'months'
              ? 'bg-white text-slate-900 font-bold shadow-xs'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <Calendar className="w-3.5 h-3.5 text-blue-600" />
          <span className="text-[11px] sm:text-xs">Mois</span>
        </button>

        <button
          onClick={() => setAdminTab('history')}
          className={`py-2 px-1 rounded-lg transition-colors flex flex-col sm:flex-row items-center justify-center gap-1.5 text-center ${
            adminTab === 'history'
              ? 'bg-white text-slate-900 font-bold shadow-xs border-b-2 border-amber-600'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <History className="w-3.5 h-3.5 text-amber-600" />
          <span className="text-[11px] sm:text-xs">Historique</span>
          {historyTotalCount > 0 && (
            <span className="text-[10px] bg-amber-100 text-amber-800 font-bold px-1.5 py-0.2 rounded-full">
              {historyTotalCount}
            </span>
          )}
        </button>

        <button
          onClick={() => setAdminTab('connection')}
          className={`py-2 px-1 rounded-lg transition-colors flex flex-col sm:flex-row items-center justify-center gap-1.5 text-center ${
            adminTab === 'connection'
              ? 'bg-white text-slate-900 font-bold shadow-xs'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <LockKeyhole className="w-3.5 h-3.5 text-slate-700" />
          <span className="text-[11px] sm:text-xs">Code PIN</span>
        </button>
      </div>

      {/* SUB-TAB EXCEL (.xlsx) DIRECT IMPORT / EXPORT */}
      {adminTab === 'excel' && (
        <AdminExcelSection
          employees={employees}
          allMonths={monthsList}
          selectedMonth={shiftEditMonth || visibleMonths[0] || '2026-09'}
          teamSchedules={teamSchedules || {}}
          tableau2Options={tableau2Options}
          onPlanningImported={(mKey, scheds, newEmps) => {
            if (newEmps && newEmps.length > 0) {
              onUpdateEmployees(newEmps);
            }
            if (onPlanningImported) {
              onPlanningImported(mKey, scheds, newEmps);
            }
          }}
        />
      )}

      {/* SUB-TAB HORAIRES POSSIBLES (TABLEAU 2) */}
      {adminTab === 'shifts_reference' && (
        <AdminTableau2Section
          tableau2Options={tableau2Options}
          onUpdateOptions={(newOpts) => setTableau2Options(newOpts)}
        />
      )}

      {/* SUB-TAB 0: MODIFIER HORAIRES PONCTUELS (TABLEAU 2) */}
      {adminTab === 'shifts' && (
        <div className="space-y-4">
          <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-4">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-bold text-slate-900">
                    Modifier un créneau horaire
                  </h3>
                  <span className="text-[10px] bg-emerald-100 text-emerald-800 font-bold px-2 py-0.5 rounded-full">
                    Admin
                  </span>
                </div>
                <p className="text-xs text-slate-500 mt-0.5">
                  Appliquez directement un créneau pré-configuré du Tableau 2 sur une date précise.
                </p>
              </div>

              <button
                type="button"
                onClick={handleExportPDF}
                disabled={isExportingTeamPdf}
                className="flex items-center gap-2 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors disabled:opacity-50 self-start sm:self-auto"
              >
                <Download className="w-3.5 h-3.5 text-slate-600" />
                <span>{isExportingTeamPdf ? 'Génération...' : 'Imprimer Planning PDF'}</span>
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Mois concerné :
                </label>
                <select
                  value={shiftEditMonth}
                  onChange={(e) => setShiftEditMonth(e.target.value)}
                  className="w-full text-xs font-semibold px-3 py-2.5 rounded-xl border border-slate-200 bg-slate-50 focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:bg-white transition-all"
                >
                  {monthsList.map((m) => (
                    <option key={m.key} value={m.key}>
                      {m.label} ({m.tab})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Salarié de l'équipe :
                </label>
                <select
                  value={shiftEditEmployee}
                  onChange={(e) => setShiftEditEmployee(e.target.value)}
                  className="w-full text-xs font-semibold px-3 py-2.5 rounded-xl border border-slate-200 bg-slate-50 focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:bg-white transition-all"
                >
                  {employees.map((emp) => (
                    <option key={emp.name} value={emp.name}>
                      {emp.name} {emp.role ? `(${emp.role})` : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Date du shift :
                </label>
                <input
                  type="date"
                  value={shiftEditDate}
                  onChange={(e) => setShiftEditDate(e.target.value)}
                  className="w-full text-xs font-semibold px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:bg-white transition-all"
                />
              </div>
            </div>

            {/* Choices corresponding strictly to Créneaux */}
            <div className="space-y-3 pt-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                  Sélectionnez le créneau souhaité :
                </span>
                <span className="text-[11px] text-slate-400">
                  {tableau2Options.length} choix configurés
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2 max-h-72 overflow-y-auto pr-1">
                {tableau2Options.map((opt) => {
                  const isSelected = shiftEditOptionId === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setShiftEditOptionId(opt.id)}
                      className={`p-3 rounded-xl border text-left text-xs transition-all flex items-center justify-between ${
                        isSelected
                          ? 'border-emerald-600 bg-emerald-50 text-emerald-950 font-bold shadow-xs ring-1 ring-emerald-500'
                          : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-700'
                      }`}
                    >
                      <div className="min-w-0 pr-1">
                        <p className="truncate">{opt.label}</p>
                        {opt.hours && (
                          <p className="text-[10px] text-emerald-700 font-mono mt-0.5 truncate">
                            {opt.hours}
                          </p>
                        )}
                      </div>
                      <div
                        className={`w-4 h-4 rounded-full flex items-center justify-center shrink-0 ${
                          isSelected ? 'bg-emerald-600 text-white' : 'border border-slate-300'
                        }`}
                      >
                        {isSelected && <Check className="w-2.5 h-2.5 stroke-[3]" />}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Real-time RH situation pill */}
            {(() => {
              const currentDirectEmployeeObj =
                employees.find((e) => e.name.toLowerCase() === shiftEditEmployee.toLowerCase()) ||
                employees[0];
              if (!currentDirectEmployeeObj) return null;

              const currentDirectBalances = calculateEmployeeBalances({
                employee: currentDirectEmployeeObj,
                selectedMonth: shiftEditMonth,
                targetDate: shiftEditDate,
              });

              const currentDirectSelectedOpt = tableau2Options.find((o) => o.id === shiftEditOptionId);
              if (!currentDirectSelectedOpt) return null;

              const directShiftImpact = simulateShiftImpact({
                currentBalances: currentDirectBalances,
                targetDate: shiftEditDate,
                currentShift: '',
                newOption: currentDirectSelectedOpt,
              });

              return (
                <div className="p-3.5 rounded-2xl bg-linear-to-r from-slate-900 to-slate-850 text-white text-xs space-y-2 border border-slate-800 shadow-sm">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2">
                      <Scale className="w-3.5 h-3.5 text-emerald-400" />
                      <span className="font-bold text-white">
                        Impact RH : {currentDirectEmployeeObj.name}
                      </span>
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-white/10 text-emerald-300">
                        {currentDirectBalances.contractLabel}
                      </span>
                    </div>
                    <span className="text-[10px] text-slate-400 font-mono">
                      Exercice : {currentDirectBalances.exercise.label}
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-200 bg-white/5 p-2 rounded-xl border border-white/5 font-medium">
                    {directShiftImpact.summaryText}
                  </div>
                </div>
              );
            })()}

            {/* Status Feedback */}
            {shiftUpdateStatus && (
              <div
                className={`p-3 rounded-xl text-xs font-semibold flex items-center gap-2 ${
                  shiftUpdateStatus.type === 'success'
                    ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                    : 'bg-rose-50 text-rose-800 border border-rose-200'
                }`}
              >
                {shiftUpdateStatus.type === 'success' ? (
                  <Check className="w-4 h-4 text-emerald-600 shrink-0" />
                ) : (
                  <ShieldAlert className="w-4 h-4 text-rose-600 shrink-0" />
                )}
                <span>{shiftUpdateStatus.text}</span>
              </div>
            )}

            {/* Action Submit */}
            <div className="flex items-center justify-end gap-3 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={handleDirectShiftUpdate}
                disabled={isUpdatingShift}
                className="flex items-center gap-2 px-5 py-2.5 text-xs font-bold text-white bg-emerald-700 hover:bg-emerald-800 active:bg-emerald-900 rounded-xl transition-all shadow-xs disabled:opacity-50"
              >
                {isUpdatingShift ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>Mise à jour du planning en cours...</span>
                  </>
                ) : (
                  <>
                    <Check className="w-4 h-4" />
                    <span>Enregistrer la modification</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* SUB-TAB 1: TEAM */}
      {adminTab === 'team' && (
        <div className="space-y-4">
          <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 shadow-xs space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold text-slate-900">Salariés de l'équipe</h3>
                <p className="text-xs text-slate-500">
                  Gérez les noms, rôles/postes (100% personnalisables), droits administrateurs et couleurs de l'équipe.
                </p>
              </div>
              <button
                onClick={handleSaveTeamToBackend}
                disabled={isSavingTeam}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-xl transition-colors disabled:opacity-50 self-start sm:self-auto"
              >
                {teamSavedSuccess ? (
                  <>
                    <Check className="w-3.5 h-3.5" />
                    <span>Enregistré !</span>
                  </>
                ) : (
                  <>
                    <RefreshCw className={`w-3.5 h-3.5 ${isSavingTeam ? 'animate-spin' : ''}`} />
                    <span>Enregistrer</span>
                  </>
                )}
              </button>
            </div>

            {/* List with customizable roles & admin status */}
            <div className="space-y-2">
              {teamList.map((emp, idx) => (
                <div
                  key={emp.name}
                  className="flex flex-col sm:flex-row sm:items-center justify-between p-3 rounded-2xl border border-slate-200 bg-slate-50/60 hover:bg-slate-50 transition-colors gap-3"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="relative shrink-0">
                      <div
                        className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold text-white shadow-2xs"
                        style={{ backgroundColor: emp.color }}
                      >
                        {emp.name.charAt(0)}
                      </div>
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-bold text-slate-900 truncate">{emp.name}</span>
                        {emp.role && (
                          <span className="text-[10px] bg-slate-200 text-slate-700 px-2 py-0.5 rounded-full font-semibold border border-slate-300/60">
                            {emp.role}
                          </span>
                        )}
                        {/* Contract Pill */}
                        <span className="text-[10px] bg-sky-50 text-sky-800 px-2 py-0.5 rounded-full font-bold border border-sky-200">
                          {emp.contractType === 'ANNUALISE'
                            ? `Annualisé (${emp.yearlyHoursQuota || 1607}h)`
                            : emp.contractType === 'FORFAIT_JOUR'
                            ? `Forfait Jour (${emp.forfaitDaysQuota || 218}j)`
                            : `${emp.weeklyHoursQuota || 35}h / sem`}
                        </span>
                        {/* Leave remaining */}
                        <span className="text-[10px] bg-amber-50 text-amber-800 px-2 py-0.5 rounded-full font-semibold border border-amber-200">
                          CP : {(emp.paidLeaveTotal ?? 25) - (emp.paidLeaveTaken ?? 0)}j
                        </span>
                        {(emp.rttTotal ?? 0) > 0 && (
                          <span className="text-[10px] bg-teal-50 text-teal-800 px-2 py-0.5 rounded-full font-semibold border border-teal-200">
                            RTT : {(emp.rttTotal ?? 0) - (emp.rttTaken ?? 0)}j
                          </span>
                        )}
                        {emp.initialHoursBalance !== undefined && emp.initialHoursBalance !== 0 && (
                          <span className="text-[10px] bg-purple-50 text-purple-800 px-2 py-0.5 rounded-full font-mono font-bold border border-purple-200">
                            Report : {emp.initialHoursBalance > 0 ? `+${emp.initialHoursBalance}h` : `${emp.initialHoursBalance}h`}
                          </span>
                        )}
                        {emp.isAdmin && (
                          <span className="text-[10px] bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full font-bold border border-emerald-200 flex items-center gap-1">
                            <ShieldCheck className="w-3 h-3 text-emerald-600" />
                            <span>Admin</span>
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        Position #{idx + 1} dans l'équipe
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-1 self-end sm:self-center shrink-0">
                    {/* Move Up */}
                    <button
                      type="button"
                      onClick={() => handleMoveEmployee(idx, 'up')}
                      disabled={idx === 0}
                      className="p-1.5 text-slate-400 hover:text-slate-700 disabled:opacity-20 rounded-lg hover:bg-slate-200 transition-colors"
                      title="Monter"
                    >
                      <ArrowUp className="w-4 h-4" />
                    </button>

                    {/* Move Down */}
                    <button
                      type="button"
                      onClick={() => handleMoveEmployee(idx, 'down')}
                      disabled={idx === teamList.length - 1}
                      className="p-1.5 text-slate-400 hover:text-slate-700 disabled:opacity-20 rounded-lg hover:bg-slate-200 transition-colors"
                      title="Descendre"
                    >
                      <ArrowDown className="w-4 h-4" />
                    </button>

                    <div className="w-px h-4 bg-slate-200 mx-1" />

                    {/* Edit Employee Button */}
                    <button
                      type="button"
                      onClick={() => handleStartEditEmployee(emp)}
                      className="p-1.5 text-slate-500 hover:text-emerald-700 hover:bg-emerald-50 rounded-lg transition-colors"
                      title={`Modifier ${emp.name} (nom, rôle, admin, couleur)`}
                    >
                      <Edit3 className="w-4 h-4" />
                    </button>

                    {/* Delete Employee Button */}
                    <button
                      type="button"
                      onClick={() => handleRequestDeleteEmployee(emp)}
                      className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                      title={`Supprimer ${emp.name}`}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Add Employee Form */}
          <form
            onSubmit={handleAddEmployee}
            className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 shadow-xs space-y-4"
          >
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
              <Plus className="w-4 h-4 text-emerald-700" />
              <span>Ajouter un salarié</span>
            </h4>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-bold text-slate-800 dark:text-slate-200 mb-1">
                  Nom du salarié *
                </label>
                <input
                  type="text"
                  required
                  placeholder="Nom du salarié"
                  value={newEmpName}
                  onChange={(e) => setNewEmpName(e.target.value)}
                  className="w-full text-xs font-bold text-slate-900 dark:text-white bg-white dark:bg-slate-950 px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-600 shadow-xs"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-800 dark:text-slate-200 mb-1">
                  Rôle / Fonction (100% libre)
                </label>
                <input
                  type="text"
                  placeholder="ex: Responsable, Conseiller-e, Apprenti-e..."
                  value={newEmpRole}
                  onChange={(e) => setNewEmpRole(e.target.value)}
                  className="w-full text-xs font-bold text-slate-900 dark:text-white bg-white dark:bg-slate-950 px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-600 shadow-xs"
                />
              </div>

              <div className="flex items-center gap-3">
                <div className="flex-1">
                  <label className="block text-xs font-bold text-slate-800 dark:text-slate-200 mb-1">
                    Couleur avatar
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={newEmpColor}
                      onChange={(e) => setNewEmpColor(e.target.value)}
                      className="w-9 h-9 rounded-xl cursor-pointer border-0 p-0 overflow-hidden shrink-0 shadow-2xs"
                      title="Couleur de l'avatar"
                    />
                    <span className="text-xs font-mono font-bold text-slate-700 dark:text-slate-300 uppercase">
                      {newEmpColor}
                    </span>
                  </div>
                </div>

                {(() => {
                  const isResp = Boolean(newEmpRole && newEmpRole.trim().toLowerCase().includes('responsable'));
                  return (
                    <div className="flex flex-col justify-end pb-1.5">
                      <label
                        className={`flex items-center gap-1.5 text-xs font-bold select-none ${
                          isResp ? 'cursor-not-allowed opacity-90' : 'cursor-pointer'
                        } text-slate-800 dark:text-slate-200`}
                      >
                        <input
                          type="checkbox"
                          checked={isResp ? true : newEmpIsAdmin}
                          disabled={isResp}
                          onChange={(e) => setNewEmpIsAdmin(e.target.checked)}
                          className="rounded border-slate-300 dark:border-slate-600 text-emerald-600 focus:ring-emerald-500 w-4 h-4 disabled:opacity-80"
                        />
                        <span>Statut Admin</span>
                      </label>
                      {isResp && (
                        <span className="text-[10px] text-emerald-700 dark:text-emerald-400 font-semibold mt-0.5">
                          Automatiquement admin
                        </span>
                      )}
                    </div>
                  );
                })()}
              </div>
            </div>

            {/* Contrat, Quotas & Compteurs RH */}
            <div className="pt-2 border-t border-slate-100 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-800">
                  Régime de travail & Compteurs (Exercice 1er Juin – 31 Mai)
                </span>
                <span className="text-[10px] text-slate-500 font-medium">
                  Gestion précise des heures et des soldes
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {/* Type de contrat */}
                <div>
                  <label className="block text-xs font-bold text-slate-800 dark:text-slate-200 mb-1">
                    Régime de travail
                  </label>
                  <select
                    value={newEmpContractType}
                    onChange={(e) => {
                      const ct = e.target.value as ContractType;
                      setNewEmpContractType(ct);
                      if (ct === 'FORFAIT_JOUR' && newEmpRttTotal === 0) {
                        setNewEmpRttTotal(10);
                      }
                    }}
                    className="w-full text-xs font-bold text-slate-900 dark:text-white bg-white dark:bg-slate-950 px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-600 shadow-xs"
                  >
                    <option value="HEBDO_35H">35h / semaine (Temps plein / partiel)</option>
                    <option value="ANNUALISE">Annualisé (Modulation annuelle)</option>
                    <option value="FORFAIT_JOUR">Forfait Jour</option>
                  </select>
                </div>

                {/* Quota d'heures ou de jours */}
                <div>
                  <label className="block text-xs font-bold text-slate-800 dark:text-slate-200 mb-1">
                    {newEmpContractType === 'ANNUALISE'
                      ? 'Quota annuel (heures)'
                      : newEmpContractType === 'FORFAIT_JOUR'
                      ? 'Quota annuel (jours)'
                      : 'Quota hebdo (heures)'}
                  </label>
                  {newEmpContractType === 'ANNUALISE' ? (
                    <input
                      type="number"
                      step="1"
                      value={newEmpYearlyQuota}
                      onChange={(e) => setNewEmpYearlyQuota(parseFloat(e.target.value) || 1607)}
                      placeholder="1607"
                      className="w-full text-xs font-bold text-slate-900 dark:text-white bg-white dark:bg-slate-950 px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-600 shadow-xs"
                    />
                  ) : newEmpContractType === 'FORFAIT_JOUR' ? (
                    <input
                      type="number"
                      step="1"
                      min="1"
                      value={newEmpForfaitDaysQuota}
                      onChange={(e) => setNewEmpForfaitDaysQuota(parseInt(e.target.value, 10) || 218)}
                      placeholder="218"
                      className="w-full text-xs font-bold text-slate-900 dark:text-white bg-white dark:bg-slate-950 px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-600 shadow-xs"
                    />
                  ) : (
                    <input
                      type="number"
                      step="0.5"
                      value={newEmpWeeklyQuota}
                      onChange={(e) => setNewEmpWeeklyQuota(parseFloat(e.target.value) || 35)}
                      placeholder="35"
                      className="w-full text-xs font-bold text-slate-900 dark:text-white bg-white dark:bg-slate-950 px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-600 shadow-xs"
                    />
                  )}
                </div>

                {/* Report d'heures initial au 1er juin */}
                <div>
                  <label className="block text-xs font-bold text-slate-800 dark:text-slate-200 mb-1">
                    Report d'heures initial (+ / -)
                  </label>
                  <input
                    type="number"
                    step="0.5"
                    disabled={newEmpContractType === 'FORFAIT_JOUR'}
                    value={newEmpInitialHoursBalance}
                    onChange={(e) => setNewEmpInitialHoursBalance(parseFloat(e.target.value) || 0)}
                    placeholder="0 (ex: +4 ou -2)"
                    className="w-full text-xs font-bold text-slate-900 dark:text-white bg-white dark:bg-slate-950 px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-600 disabled:bg-slate-100 dark:disabled:bg-slate-850 disabled:text-slate-400 shadow-xs"
                  />
                  <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
                    Solde initial au 1er juin (exercice)
                  </p>
                </div>
              </div>

              {/* Congés Payés & RTT */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 pt-1 bg-slate-50 dark:bg-slate-900/60 p-2.5 rounded-xl border border-slate-200/70 dark:border-slate-800">
                <div>
                  <label className="block text-[11px] font-bold text-slate-800 dark:text-slate-200 mb-0.5">
                    CP Acquis (total)
                  </label>
                  <input
                    type="number"
                    step="1"
                    min="0"
                    value={newEmpPaidLeaveTotal}
                    onChange={(e) => setNewEmpPaidLeaveTotal(parseInt(e.target.value, 10) || 0)}
                    className="w-full text-xs font-bold text-slate-900 dark:text-white bg-white dark:bg-slate-950 px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 shadow-2xs"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-800 dark:text-slate-200 mb-0.5">
                    CP Déjà pris au 1er juin
                  </label>
                  <input
                    type="number"
                    step="1"
                    min="0"
                    value={newEmpPaidLeaveTaken}
                    onChange={(e) => setNewEmpPaidLeaveTaken(parseInt(e.target.value, 10) || 0)}
                    className="w-full text-xs font-bold text-slate-900 dark:text-white bg-white dark:bg-slate-950 px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 shadow-2xs"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-800 dark:text-slate-200 mb-0.5">
                    RTT Acquis (total)
                  </label>
                  <input
                    type="number"
                    step="1"
                    min="0"
                    value={newEmpRttTotal}
                    onChange={(e) => setNewEmpRttTotal(parseInt(e.target.value, 10) || 0)}
                    className="w-full text-xs font-bold text-slate-900 dark:text-white bg-white dark:bg-slate-950 px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 shadow-2xs"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-800 dark:text-slate-200 mb-0.5">
                    RTT Déjà pris au 1er juin
                  </label>
                  <input
                    type="number"
                    step="1"
                    min="0"
                    value={newEmpRttTaken}
                    onChange={(e) => setNewEmpRttTaken(parseInt(e.target.value, 10) || 0)}
                    className="w-full text-xs font-bold text-slate-900 dark:text-white bg-white dark:bg-slate-950 px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 shadow-2xs"
                  />
                </div>
              </div>
            </div>

            <div className="flex justify-end pt-2 border-t border-slate-100">
              <button
                type="submit"
                disabled={!newEmpName.trim()}
                className="flex items-center gap-1.5 py-2 px-5 text-xs font-bold text-white bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 rounded-xl transition-colors shadow-xs"
              >
                <Plus className="w-4 h-4" />
                <span>Ajouter ce salarié</span>
              </button>
            </div>
          </form>

          {/* MODAL: MODIFIER UN SALARIÉ */}
          {employeeToEdit && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200">
              <div className="bg-white rounded-3xl border border-slate-200 shadow-2xl max-w-lg w-full p-5 space-y-4 max-h-[92vh] overflow-y-auto">
                <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                  <div className="flex items-center gap-2.5">
                    <div
                      className="w-9 h-9 rounded-xl flex items-center justify-center text-sm font-bold text-white shadow-2xs"
                      style={{ backgroundColor: editEmpColor }}
                    >
                      {editEmpName.charAt(0) || '?'}
                    </div>
                    <div>
                      <h4 className="text-sm font-bold text-slate-900">
                        Modifier le salarié
                      </h4>
                      <p className="text-[11px] text-slate-500">
                        Informations de profil, contrat et compteurs
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setEmployeeToEdit(null)}
                    className="p-1 rounded-lg text-slate-400 hover:text-slate-600"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <form onSubmit={handleSaveEditEmployee} className="space-y-3.5">
                  <div>
                    <label className="block text-xs font-bold text-slate-800 dark:text-slate-200 mb-1">
                      Nom du salarié *
                    </label>
                    <input
                      type="text"
                      required
                      value={editEmpName}
                      onChange={(e) => setEditEmpName(e.target.value)}
                      className="w-full text-xs font-bold text-slate-900 dark:text-white bg-white dark:bg-slate-950 px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-600 shadow-xs"
                    />
                    <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-1">
                      Si vous modifiez le nom, tous les plannings du salarié seront automatiquement conservés et transférés sous le nouveau nom.
                    </p>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-800 dark:text-slate-200 mb-1">
                      Rôle / Fonction (libre)
                    </label>
                    <input
                      type="text"
                      placeholder="ex: Responsable, Conseiller-e, Adjoint-e, Apprenti-e..."
                      value={editEmpRole}
                      onChange={(e) => setEditEmpRole(e.target.value)}
                      className="w-full text-xs font-bold text-slate-900 dark:text-white bg-white dark:bg-slate-950 px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-600 shadow-xs"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3 pt-1">
                    <div>
                      <label className="block text-xs font-bold text-slate-800 dark:text-slate-200 mb-1">
                        Couleur d'avatar
                      </label>
                      <div className="flex items-center gap-2">
                        <input
                          type="color"
                          value={editEmpColor}
                          onChange={(e) => setEditEmpColor(e.target.value)}
                          className="w-9 h-9 rounded-xl cursor-pointer border-0 p-0 overflow-hidden shrink-0 shadow-2xs"
                        />
                        <span className="text-xs font-mono font-bold text-slate-700 dark:text-slate-300 uppercase">
                          {editEmpColor}
                        </span>
                      </div>
                    </div>

                    {(() => {
                      const isResp = Boolean(editEmpRole && editEmpRole.trim().toLowerCase().includes('responsable'));
                      return (
                        <div className="flex flex-col justify-end pb-1.5">
                          <label
                            className={`flex items-center gap-2 text-xs font-bold select-none ${
                              isResp ? 'cursor-not-allowed opacity-90' : 'cursor-pointer'
                            } text-slate-800 dark:text-slate-200`}
                          >
                            <input
                              type="checkbox"
                              checked={isResp ? true : editEmpIsAdmin}
                              disabled={isResp}
                              onChange={(e) => setEditEmpIsAdmin(e.target.checked)}
                              className="rounded border-slate-300 dark:border-slate-600 text-emerald-600 focus:ring-emerald-500 w-4 h-4 disabled:opacity-80"
                            />
                            <span>Droits Admin</span>
                          </label>
                          {isResp && (
                            <p className="text-[10px] text-emerald-700 dark:text-emerald-400 font-semibold mt-1">
                              Le responsable est obligatoirement administrateur (non modifiable).
                            </p>
                          )}
                        </div>
                      );
                    })()}
                  </div>

                  {/* Section Contrat & Compteurs Exercice Annuel (1er Juin - 31 Mai) */}
                  <div className="pt-3 border-t border-slate-100 dark:border-slate-800 space-y-3">
                    <div className="flex items-center justify-between">
                      <h5 className="text-xs font-bold text-slate-900 dark:text-white">
                        Régime de travail & Compteurs (1er Juin – 31 Mai)
                      </h5>
                      <span className="text-[10px] font-mono text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/70 px-2 py-0.5 rounded-md border border-emerald-200 dark:border-emerald-800">
                        Calcul en temps réel
                      </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      {/* Contrat */}
                      <div>
                        <label className="block text-xs font-bold text-slate-800 dark:text-slate-200 mb-1">
                          Régime de travail
                        </label>
                        <select
                          value={editEmpContractType}
                          onChange={(e) => {
                            const ct = e.target.value as ContractType;
                            setEditEmpContractType(ct);
                            if (ct === 'FORFAIT_JOUR' && editEmpRttTotal === 0) {
                              setEditEmpRttTotal(10);
                            }
                          }}
                          className="w-full text-xs font-bold text-slate-900 dark:text-white bg-white dark:bg-slate-950 px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-600 shadow-xs"
                        >
                          <option value="HEBDO_35H">35h / semaine</option>
                          <option value="ANNUALISE">Annualisé (Modulation)</option>
                          <option value="FORFAIT_JOUR">Forfait Jour</option>
                        </select>
                      </div>

                      {/* Quota */}
                      <div>
                        <label className="block text-xs font-bold text-slate-800 dark:text-slate-200 mb-1">
                          {editEmpContractType === 'ANNUALISE'
                            ? 'Quota annuel (h)'
                            : editEmpContractType === 'FORFAIT_JOUR'
                            ? 'Quota annuel (jours)'
                            : 'Quota hebdo (h)'}
                        </label>
                        {editEmpContractType === 'ANNUALISE' ? (
                          <input
                            type="number"
                            step="1"
                            value={editEmpYearlyQuota}
                            onChange={(e) => setEditEmpYearlyQuota(parseFloat(e.target.value) || 1607)}
                            className="w-full text-xs font-bold text-slate-900 dark:text-white bg-white dark:bg-slate-950 px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-600 shadow-xs"
                          />
                        ) : editEmpContractType === 'FORFAIT_JOUR' ? (
                          <input
                            type="number"
                            step="1"
                            min="1"
                            value={editEmpForfaitDaysQuota}
                            onChange={(e) => setEditEmpForfaitDaysQuota(parseInt(e.target.value, 10) || 218)}
                            placeholder="218"
                            className="w-full text-xs font-bold text-slate-900 dark:text-white bg-white dark:bg-slate-950 px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-600 shadow-xs"
                          />
                        ) : (
                          <input
                            type="number"
                            step="0.5"
                            value={editEmpWeeklyQuota}
                            onChange={(e) => setEditEmpWeeklyQuota(parseFloat(e.target.value) || 35)}
                            className="w-full text-xs font-bold text-slate-900 dark:text-white bg-white dark:bg-slate-950 px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-600 shadow-xs"
                          />
                        )}
                      </div>

                      {/* Report d'heures */}
                      <div>
                        <label className="block text-xs font-bold text-slate-800 dark:text-slate-200 mb-1">
                          Report 1er juin (+ / -)
                        </label>
                        <input
                          type="number"
                          step="0.5"
                          disabled={editEmpContractType === 'FORFAIT_JOUR'}
                          value={editEmpInitialHoursBalance}
                          onChange={(e) => setEditEmpInitialHoursBalance(parseFloat(e.target.value) || 0)}
                          placeholder="0"
                          className="w-full text-xs font-bold text-slate-900 dark:text-white bg-white dark:bg-slate-950 px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-600 disabled:bg-slate-100 dark:disabled:bg-slate-850 disabled:text-slate-400 shadow-xs"
                        />
                      </div>
                    </div>

                    {/* Congés Payés & RTT */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 bg-slate-50 dark:bg-slate-900/60 p-2.5 rounded-xl border border-slate-200/70 dark:border-slate-800">
                      <div>
                        <label className="block text-[11px] font-bold text-slate-800 dark:text-slate-200 mb-0.5">
                          CP Acquis (total)
                        </label>
                        <input
                          type="number"
                          step="1"
                          min="0"
                          value={editEmpPaidLeaveTotal}
                          onChange={(e) => setEditEmpPaidLeaveTotal(parseInt(e.target.value, 10) || 0)}
                          className="w-full text-xs font-bold text-slate-900 dark:text-white bg-white dark:bg-slate-950 px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 shadow-2xs"
                        />
                      </div>

                      <div>
                        <label className="block text-[11px] font-bold text-slate-800 dark:text-slate-200 mb-0.5">
                          CP Déjà pris au 1er juin
                        </label>
                        <input
                          type="number"
                          step="1"
                          min="0"
                          value={editEmpPaidLeaveTaken}
                          onChange={(e) => setEditEmpPaidLeaveTaken(parseInt(e.target.value, 10) || 0)}
                          className="w-full text-xs font-bold text-slate-900 dark:text-white bg-white dark:bg-slate-950 px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 shadow-2xs"
                        />
                      </div>

                      <div>
                        <label className="block text-[11px] font-bold text-slate-800 dark:text-slate-200 mb-0.5">
                          RTT Acquis (total)
                        </label>
                        <input
                          type="number"
                          step="1"
                          min="0"
                          value={editEmpRttTotal}
                          onChange={(e) => setEditEmpRttTotal(parseInt(e.target.value, 10) || 0)}
                          className="w-full text-xs font-bold text-slate-900 dark:text-white bg-white dark:bg-slate-950 px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 shadow-2xs"
                        />
                      </div>

                      <div>
                        <label className="block text-[11px] font-bold text-slate-800 dark:text-slate-200 mb-0.5">
                          RTT Déjà pris au 1er juin
                        </label>
                        <input
                          type="number"
                          step="1"
                          min="0"
                          value={editEmpRttTaken}
                          onChange={(e) => setEditEmpRttTaken(parseInt(e.target.value, 10) || 0)}
                          className="w-full text-xs font-bold text-slate-900 dark:text-white bg-white dark:bg-slate-950 px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 shadow-2xs"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                    <button
                      type="button"
                      onClick={() => setEmployeeToEdit(null)}
                      className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100 transition-colors"
                    >
                      Annuler
                    </button>
                    <button
                      type="submit"
                      className="px-5 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-xs shadow-xs transition-colors"
                    >
                      Enregistrer
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </div>
      )}

      {/* SUB-TAB 2: MONTHS */}
      {adminTab === 'months' && (
        <div className="space-y-4">
          <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-slate-900">Mois de planning</h3>
                <p className="text-xs text-slate-500">
                  Créez, modifiez ou supprimez des mois. Cochez les mois visibles dans les plannings des salariés.
                </p>
              </div>
              <button
                onClick={handleSaveMonthsToBackend}
                disabled={isSavingMonths}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg transition-colors disabled:opacity-50"
              >
                {monthsSavedSuccess ? (
                  <>
                    <Check className="w-3.5 h-3.5" />
                    <span>Sauvegardé !</span>
                  </>
                ) : (
                  <>
                    <RefreshCw className={`w-3.5 h-3.5 ${isSavingMonths ? 'animate-spin' : ''}`} />
                    <span>Enregistrer</span>
                  </>
                )}
              </button>
            </div>

            {/* List of existing months with Edit and Delete options */}
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5">
              {monthsList.map((m) => {
                const isChecked = selectedVisibleMonths.includes(m.key);
                const calDays = getCalendarDaysForMonth(m.key);

                return (
                  <div
                    key={m.key}
                    className={`p-3 rounded-xl border transition-all flex flex-col justify-between gap-2.5 ${
                      isChecked
                        ? 'border-emerald-600 bg-emerald-50/40 text-emerald-950 shadow-2xs'
                        : 'border-slate-200 bg-white text-slate-700'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-xs font-bold truncate">{m.label}</p>
                        <p className="text-[10px] text-slate-500 font-mono mt-0.5">
                          Onglet : <span className="font-semibold">{m.tab}</span>
                        </p>
                        {(() => {
                          const mCal = getMonthWorkingCalendar(m.key, undefined, m);
                          return (
                            <p className="text-[10px] text-emerald-700 mt-0.5 flex items-center gap-1">
                              <CalendarDays className="w-3 h-3 shrink-0" />
                              <span>
                                {mCal.netWorkingDays}j ouvrés ({mCal.standardBaseHours}h)
                                {mCal.isCustomized ? ' · modulé' : ''}
                              </span>
                            </p>
                          );
                        })()}
                      </div>

                      {/* Visible checkbox toggle */}
                      <button
                        type="button"
                        onClick={() => handleToggleMonthVisibility(m.key)}
                        className={`w-6 h-6 rounded-lg flex items-center justify-center shrink-0 transition-colors ${
                          isChecked
                            ? 'bg-emerald-700 text-white shadow-xs'
                            : 'border border-slate-300 hover:bg-slate-100 text-transparent'
                        }`}
                        title={isChecked ? 'Mois visible (cliquez pour masquer)' : 'Mois masqué (cliquez pour afficher)'}
                      >
                        <Check className="w-3.5 h-3.5 stroke-[3]" />
                      </button>
                    </div>

                    {/* Bottom actions: Edit and Delete */}
                    <div className="flex items-center justify-between pt-2 border-t border-slate-200/60 text-[11px]">
                      <span className="font-mono text-[10px] text-slate-400">{m.key}</span>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => handleStartEditMonth(m)}
                          className="p-1 rounded-md text-slate-500 hover:text-emerald-700 hover:bg-emerald-50 transition-colors"
                          title={`Modifier le mois ${m.label}`}
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setMonthToDelete(m)}
                          className="p-1 rounded-md text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors"
                          title={`Supprimer le mois ${m.label}`}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Form to create a new month with automatic calendar dates matching */}
          <form
            onSubmit={handleAddMonth}
            className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs space-y-3"
          >
            <div>
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-800">
                Créer un nouveau mois de planning
              </h4>
              <p className="text-[11px] text-slate-500">
                Les dates de planning générées correspondent strictement au calendrier réel du mois sélectionné.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-4 gap-2.5">
              <div>
                <label className="block text-[10px] font-bold text-slate-700 dark:text-slate-300 uppercase mb-1">
                  Mois & Année :
                </label>
                <input
                  type="month"
                  value={newMonthPickerVal}
                  onChange={(e) => handleMonthPickerChange(e.target.value)}
                  className="w-full text-xs font-bold text-slate-900 dark:text-white bg-white dark:bg-slate-950 px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 focus:outline-none focus:ring-1 focus:ring-emerald-600 shadow-2xs"
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-700 dark:text-slate-300 uppercase mb-1">
                  Libellé affiché :
                </label>
                <input
                  type="text"
                  placeholder="ex: Novembre 2026"
                  value={newMonthLabel}
                  onChange={(e) => setNewMonthLabel(e.target.value)}
                  className="w-full text-xs font-bold text-slate-900 dark:text-white bg-white dark:bg-slate-950 px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-emerald-600 shadow-2xs"
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-700 dark:text-slate-300 uppercase mb-1">
                  Onglet Excel :
                </label>
                <input
                  type="text"
                  placeholder="ex: NOVEMBRE 26"
                  value={newMonthTab}
                  onChange={(e) => setNewMonthTab(e.target.value.toUpperCase())}
                  className="w-full text-xs font-bold text-slate-900 dark:text-white bg-white dark:bg-slate-950 px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-emerald-600 uppercase shadow-2xs"
                />
              </div>

              <div className="flex flex-col justify-end">
                <button
                  type="submit"
                  disabled={!newMonthPickerVal.trim()}
                  className="flex items-center justify-center gap-1.5 py-2 px-4 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 rounded-lg transition-colors shadow-2xs h-[38px]"
                >
                  <Plus className="w-4 h-4" />
                  <span>Créer le mois</span>
                </button>
              </div>
            </div>

            {newMonthPickerVal && (
              <div className="text-[11px] text-emerald-800 bg-emerald-50/70 p-2.5 rounded-lg border border-emerald-200 flex items-center gap-2">
                <Info className="w-3.5 h-3.5 shrink-0 text-emerald-700" />
                <span>
                  Calendrier officiel détecté : <strong>{getMonthCalendarSummary(newMonthPickerVal)}</strong>
                </span>
              </div>
            )}
          </form>
        </div>
      )}

      {/* SUB-TAB 3: CONNECTION, SECURITY & PUSH NOTIFICATIONS */}
      {/* SUB-TAB: CODE PIN ADMINISTRATEUR */}
      {adminTab === 'connection' && (
        <div className="space-y-4">
          {/* Section: Modifier le Code PIN Administrateur */}
          <form
            onSubmit={handleChangeAdminPin}
            className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-4"
          >
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-emerald-100 text-emerald-800 flex items-center justify-center">
                <LockKeyhole className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  Code PIN d'accès Administrateur (6 chiffres)
                </h3>
                <p className="text-xs text-slate-500">
                  Modifiez le code confidentiel à 6 chiffres qui protège cet espace d'administration pour ce magasin.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
              <div>
                <label className="block text-xs font-bold text-slate-800 dark:text-slate-200 mb-1">
                  Nouveau code PIN (6 chiffres) :
                </label>
                <input
                  type="password"
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="••••••"
                  value={newAdminPin}
                  onChange={(e) => setNewAdminPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  className="w-full text-xs font-mono font-bold text-slate-900 dark:text-white bg-white dark:bg-slate-950 px-3 py-2.5 rounded-lg border border-slate-300 dark:border-slate-700 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-emerald-600 tracking-widest text-center shadow-2xs"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-800 dark:text-slate-200 mb-1">
                  Confirmer le code PIN (6 chiffres) :
                </label>
                <input
                  type="password"
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="••••••"
                  value={confirmAdminPin}
                  onChange={(e) => setConfirmAdminPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  className="w-full text-xs font-mono font-bold text-slate-900 dark:text-white bg-white dark:bg-slate-950 px-3 py-2.5 rounded-lg border border-slate-300 dark:border-slate-700 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-emerald-600 tracking-widest text-center shadow-2xs"
                />
              </div>
            </div>

            {adminPinError && (
              <p className="text-xs text-rose-600 font-medium">{adminPinError}</p>
            )}

            {adminPinSuccess && (
              <p className="text-xs text-emerald-700 font-semibold flex items-center gap-1">
                <Check className="w-4 h-4" />
                <span>Code PIN administrateur modifié avec succès !</span>
              </p>
            )}

            <button
              type="submit"
              disabled={!newAdminPin.trim() || !confirmAdminPin.trim()}
              className="px-4 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 rounded-lg transition-colors cursor-pointer"
            >
              Mettre à jour le code PIN Admin
            </button>
          </form>

          {/* Notice Super-Admin Gestionnaire */}
          <div className="bg-slate-50 rounded-2xl border border-slate-200 p-5 space-y-2">
            <div className="flex items-center gap-2 text-slate-800 text-xs font-bold">
              <ShieldCheck className="w-4 h-4 text-emerald-600" />
              <span>Gestion Réseau & Multi-Magasins</span>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed">
              En cas de perte d'accés, veuillez contacter votre administrateur réseau.
            </p>
          </div>
        </div>
      )}

      {/* SUB-TAB HISTORIQUE DES MODIFICATIONS (OPTION A) */}
      {adminTab === 'history' && (
        <div className="space-y-4">
          <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-4">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-4">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-amber-100 text-amber-800 flex items-center justify-center font-bold shadow-2xs">
                  <History className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-bold text-slate-900">
                      Historique des modifications
                    </h3>
                    <span className="text-[10px] bg-amber-100 text-amber-800 font-bold px-2 py-0.5 rounded-full">
                      Journal Magasin
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Historique des changements d'horaires et de créneaux enregistrés pour ce magasin.
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 self-start sm:self-auto">
                <button
                  type="button"
                  onClick={loadAdminHistory}
                  disabled={isLoadingHistory}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors disabled:opacity-50"
                  title="Rafraîchir l'historique"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isLoadingHistory ? 'animate-spin' : ''}`} />
                  <span>Actualiser</span>
                </button>

                {historyTotalCount > 0 && (
                  <button
                    type="button"
                    onClick={() => setIsPurgeAllHistoryModalOpen(true)}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-xl shadow-xs transition-colors cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Purger tout l'historique</span>
                  </button>
                )}
              </div>
            </div>

            {/* Statistics Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="bg-slate-50 rounded-xl p-3 border border-slate-200">
                <span className="text-[11px] font-semibold text-slate-500">Total modifications</span>
                <div className="text-xl font-bold text-slate-900 mt-0.5">{historyTotalCount}</div>
                <span className="text-[10px] text-slate-500">enregistrées dans ce magasin</span>
              </div>

              <div className="bg-slate-50 rounded-xl p-3 border border-slate-200">
                <span className="text-[11px] font-semibold text-slate-500">Salariés concernés</span>
                <div className="text-xl font-bold text-slate-900 mt-0.5">
                  {Object.keys(historyByEmployee).length}
                </div>
                <span className="text-[10px] text-slate-500">sur {employees.length} collaborateurs</span>
              </div>

              <div className="bg-slate-50 rounded-xl p-3 border border-slate-200">
                <span className="text-[11px] font-semibold text-slate-500">Dernier changement</span>
                <div className="text-xs font-bold text-slate-800 mt-1 truncate">
                  {historyRecords[0]
                    ? new Date(historyRecords[0].timestamp).toLocaleDateString('fr-FR', {
                        day: 'numeric',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                      })
                    : 'Aucun'}
                </div>
                <span className="text-[10px] text-slate-500 truncate block">
                  {historyRecords[0] ? `sur ${historyRecords[0].employee}` : 'Journal vide'}
                </span>
              </div>
            </div>

            {/* Filter and Search Bar */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5 pt-1">
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative min-w-[220px]">
                  <select
                    value={historyFilterEmployee}
                    onChange={(e) => setHistoryFilterEmployee(e.target.value)}
                    className="w-full text-xs font-semibold px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:bg-white"
                  >
                    <option value="all">Tous les salariés ({historyTotalCount})</option>
                    {employees.map((emp) => {
                      const count = historyByEmployee[emp.name] || 0;
                      return (
                        <option key={emp.name} value={emp.name}>
                          {emp.name} ({count} modif{count > 1 ? 's' : ''})
                        </option>
                      );
                    })}
                  </select>
                </div>

                {historyFilterEmployee !== 'all' && (
                  <button
                    type="button"
                    onClick={() => {
                      const count = historyByEmployee[historyFilterEmployee] || 0;
                      setHistoryEmployeeToDelete({ name: historyFilterEmployee, count });
                    }}
                    disabled={(historyByEmployee[historyFilterEmployee] || 0) === 0}
                    className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-xl transition-colors disabled:opacity-40 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Supprimer l'historique de {historyFilterEmployee}</span>
                  </button>
                )}
              </div>

              <div className="relative w-full sm:w-64">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Rechercher (date, horaire...)"
                  value={historySearchQuery}
                  onChange={(e) => setHistorySearchQuery(e.target.value)}
                  className="w-full text-xs pl-8 pr-3 py-2 rounded-xl border border-slate-200 bg-slate-50 focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:bg-white"
                />
              </div>
            </div>

            {/* List / Table */}
            {isLoadingHistory ? (
              <div className="text-center py-12 text-slate-400 text-xs">
                <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-emerald-600" />
                Chargement de l'historique...
              </div>
            ) : filteredHistory.length === 0 ? (
              <div className="text-center py-10 bg-slate-50 rounded-xl border border-slate-200/80 p-6 space-y-2">
                <div className="w-10 h-10 rounded-full bg-slate-200 text-slate-500 flex items-center justify-center mx-auto">
                  <History className="w-5 h-5" />
                </div>
                <h4 className="text-xs font-bold text-slate-700">Aucun historique trouvé</h4>
                <p className="text-[11px] text-slate-500 max-w-sm mx-auto">
                  {historyTotalCount === 0
                    ? "Aucune modification d'horaire n'a été enregistrée pour ce magasin."
                    : "Aucun événement ne correspond aux critères de recherche sélectionnés."}
                </p>
              </div>
            ) : (
              <div className="border border-slate-200 rounded-xl overflow-hidden shadow-2xs">
                <div className="overflow-x-auto max-h-[500px]">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-100 text-slate-600 font-bold border-b border-slate-200 sticky top-0 z-10">
                      <tr>
                        <th className="py-2.5 px-3">Date & Heure</th>
                        <th className="py-2.5 px-3">Salarié</th>
                        <th className="py-2.5 px-3">Date modifiée</th>
                        <th className="py-2.5 px-3">Détail de la modification</th>
                        <th className="py-2.5 px-3 text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 bg-white">
                      {filteredHistory.map((item, idx) => (
                        <tr key={item.id || `${item.timestamp}_${idx}`} className="hover:bg-slate-50/80 transition-colors">
                          <td className="py-2.5 px-3 font-mono text-[11px] text-slate-500 whitespace-nowrap">
                            {new Date(item.timestamp).toLocaleDateString('fr-FR', {
                              day: '2-digit',
                              month: '2-digit',
                              year: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </td>
                          <td className="py-2.5 px-3 font-semibold text-slate-800 whitespace-nowrap">
                            <span className="inline-flex items-center gap-1.5">
                              <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                              {item.employee}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 font-medium text-slate-700 whitespace-nowrap">
                            {item.date}
                          </td>
                          <td className="py-2.5 px-3 text-slate-600">
                            <span className="bg-slate-100 text-slate-800 font-mono px-2 py-0.5 rounded text-[11px]">
                              {item.change}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-right whitespace-nowrap">
                            <button
                              type="button"
                              onClick={() => {
                                const count = historyByEmployee[item.employee] || 1;
                                setHistoryEmployeeToDelete({ name: item.employee, count });
                              }}
                              className="text-[11px] text-rose-600 hover:text-rose-800 font-semibold hover:underline inline-flex items-center gap-1 cursor-pointer"
                              title={`Supprimer l'historique de ${item.employee}`}
                            >
                              <Trash2 className="w-3 h-3" />
                              <span>Effacer salarié</span>
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="bg-slate-50 px-3 py-2 border-t border-slate-200 text-[11px] text-slate-500 flex items-center justify-between">
                  <span>Affichage de {filteredHistory.length} sur {historyTotalCount} entrée(s)</span>
                  {historyFilterEmployee !== 'all' && (
                    <button
                      type="button"
                      onClick={() => setHistoryFilterEmployee('all')}
                      className="text-emerald-700 font-semibold hover:underline cursor-pointer"
                    >
                      Réinitialiser le filtre
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* MODAL: CONFIRMATION SUPPRESSION SALARIÉ (100% fiable, pas de window.confirm) */}
      {employeeToDelete && (
        <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xl max-w-sm w-full space-y-4">
            <div className="w-10 h-10 rounded-full bg-rose-100 text-rose-700 flex items-center justify-center mx-auto">
              <Trash2 className="w-5 h-5" />
            </div>

            <div className="text-center space-y-1">
              <h4 className="text-sm font-bold text-slate-900">
                Supprimer le salarié « {employeeToDelete.name} » ?
              </h4>
              <p className="text-xs text-slate-500">
                Ce salarié sera retiré de la liste de l'équipe et des vues de consultation.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2 pt-2">
              <button
                type="button"
                onClick={() => setEmployeeToDelete(null)}
                className="py-2 px-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs transition-colors"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={handleConfirmDeleteEmployee}
                className="py-2 px-3 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs shadow-xs transition-colors"
              >
                Supprimer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: MODIFIER UN MOIS */}
      {monthToEdit && (
        <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 shadow-xl max-w-md w-full space-y-4 text-slate-900 dark:text-white transition-colors">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-emerald-100 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-300 flex items-center justify-center">
                  <Edit3 className="w-4 h-4" />
                </div>
                <h4 className="text-sm font-bold text-slate-900 dark:text-white">
                  Modifier le mois « {monthToEdit.label} »
                </h4>
              </div>
              <button
                onClick={() => setMonthToEdit(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveEditMonth} className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-slate-800 dark:text-slate-200 mb-1">
                  Clé du mois (AAAA-MM) :
                </label>
                <input
                  type="month"
                  value={editMonthKey}
                  onChange={(e) => {
                    const val = e.target.value;
                    setEditMonthKey(val);
                    if (val && val.includes('-')) {
                      setEditMonthLabel(getFrenchMonthLabel(val));
                      setEditMonthTab(getExcelTabLabel(val));
                    }
                  }}
                  className="w-full text-xs font-bold text-slate-900 dark:text-white bg-white dark:bg-slate-950 px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-600 shadow-xs"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-800 dark:text-slate-200 mb-1">
                  Libellé complet :
                </label>
                <input
                  type="text"
                  required
                  value={editMonthLabel}
                  onChange={(e) => setEditMonthLabel(e.target.value)}
                  className="w-full text-xs font-bold text-slate-900 dark:text-white bg-white dark:bg-slate-950 px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-600 shadow-xs"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-800 dark:text-slate-200 mb-1">
                  Nom d'onglet Excel :
                </label>
                <input
                  type="text"
                  required
                  value={editMonthTab}
                  onChange={(e) => setEditMonthTab(e.target.value.toUpperCase())}
                  className="w-full text-xs font-bold text-slate-900 dark:text-white bg-white dark:bg-slate-950 px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-600 uppercase shadow-xs"
                />
              </div>

              {/* Working days & Base hours modulation */}
              <div className="bg-slate-50 dark:bg-slate-900/60 p-3 rounded-xl border border-slate-200/80 dark:border-slate-800 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                    <CalendarDays className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                    <span>Base horaire & Jours ouvrés du mois</span>
                  </span>
                  <span className="text-[10px] text-slate-500 dark:text-slate-400">
                    Samedi & Dimanche chômés
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                      Jours ouvrés (Mon-Fri) :
                    </label>
                    <input
                      type="number"
                      min="0"
                      max="31"
                      placeholder={`Auto : ${getMonthWorkingCalendar(editMonthKey).netWorkingDays}j`}
                      value={editMonthCustomWorkingDays}
                      onChange={(e) => {
                        const val = e.target.value;
                        setEditMonthCustomWorkingDays(val);
                        if (val !== '' && !isNaN(parseInt(val, 10))) {
                          setEditMonthCustomBaseHours(String(parseInt(val, 10) * 7));
                        }
                      }}
                      className="w-full text-xs font-bold text-slate-900 dark:text-white bg-white dark:bg-slate-950 px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-600 shadow-2xs"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                      Base d'heures du mois :
                    </label>
                    <input
                      type="number"
                      step="0.1"
                      min="0"
                      placeholder={`Auto : ${getMonthWorkingCalendar(editMonthKey).standardBaseHours}h`}
                      value={editMonthCustomBaseHours}
                      onChange={(e) => setEditMonthCustomBaseHours(e.target.value)}
                      className="w-full text-xs font-bold text-slate-900 dark:text-white bg-white dark:bg-slate-950 px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-600 shadow-2xs"
                    />
                  </div>
                </div>

                <p className="text-[10px] text-slate-500 dark:text-slate-400 leading-relaxed">
                  Laissez vide pour conserver le <strong>calcul automatique</strong> basé sur les jours ouvrés réels du mois (7h/jour ouvré, hors jours fériés). Remplissez pour moduler manuellement.
                </p>
              </div>

              <div className="text-[11px] text-emerald-800 bg-emerald-50 p-2.5 rounded-lg border border-emerald-200">
                Calendrier correspondant : <strong>{getMonthCalendarSummary(editMonthKey)}</strong>
              </div>

              <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setMonthToEdit(null)}
                  className="py-2 px-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  className="py-2 px-3 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-xs shadow-xs"
                >
                  Enregistrer
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: REMISE À ZÉRO POUR UN NOUVEAU MAGASIN */}
      {isResetStoreModalOpen && (
        <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 shadow-xl max-w-md w-full space-y-4 text-slate-900 dark:text-white transition-colors">
            <div className="w-12 h-12 rounded-full bg-rose-100 dark:bg-rose-950/80 text-rose-700 dark:text-rose-300 flex items-center justify-center mx-auto">
              <AlertTriangle className="w-6 h-6" />
            </div>

            <div className="text-center space-y-1.5">
              <h4 className="text-base font-bold text-slate-900 dark:text-white">
                Remettre l'application à zéro ?
              </h4>
              <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                Cette opération prépare l'application pour un <strong>nouveau magasin</strong> en effaçant tous les salariés personnalisés, les notes et les plannings du magasin précédent.
              </p>
              <div className="p-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800/80 text-emerald-900 dark:text-emerald-200 text-xs text-left space-y-1">
                <p className="font-semibold">Ce qui sera conservé intact :</p>
                <ul className="list-disc list-inside text-[11px] text-emerald-800 dark:text-emerald-300 space-y-0.5">
                  <li>Le compte Administrateur nommé « Responsable » (accès complet préservé)</li>
                  <li>Les créneaux et horaires types d'exemple</li>
                  <li>Le code PIN d'accès Administrateur</li>
                </ul>
              </div>
            </div>

            <div className="space-y-1">
              <label className="block text-xs font-bold text-slate-800 dark:text-slate-200">
                Nom du nouveau magasin / entreprise :
              </label>
              <input
                type="text"
                value={resetStoreInput}
                onChange={(e) => setResetStoreInput(e.target.value)}
                placeholder="Ex: Mon Nouveau Magasin"
                className="w-full text-xs font-bold text-slate-900 dark:text-white bg-white dark:bg-slate-950 px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-600 shadow-xs"
              />
            </div>

            <div className="grid grid-cols-2 gap-2 pt-2">
              <button
                type="button"
                onClick={() => setIsResetStoreModalOpen(false)}
                className="py-2.5 px-3 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-semibold text-xs transition-colors"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={handleConfirmResetStore}
                className="py-2.5 px-3 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs shadow-xs transition-colors"
              >
                Confirmer la remise à zéro
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: CONFIRMATION SUPPRESSION MOIS */}
      {monthToDelete && (
        <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xl max-w-sm w-full space-y-4">
            <div className="w-10 h-10 rounded-full bg-rose-100 text-rose-700 flex items-center justify-center mx-auto">
              <Trash2 className="w-5 h-5" />
            </div>

            <div className="text-center space-y-1">
              <h4 className="text-sm font-bold text-slate-900">
                Supprimer le mois « {monthToDelete.label} » ?
              </h4>
              <p className="text-xs text-slate-500">
                Ce mois sera définitivement retiré des plannings et de l'application.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2 pt-2">
              <button
                type="button"
                onClick={() => setMonthToDelete(null)}
                className="py-2 px-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs transition-colors"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={handleConfirmDeleteMonth}
                className="py-2 px-3 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs shadow-xs transition-colors"
              >
                Supprimer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: CONFIRMATION SUPPRESSION HISTORIQUE SALARIÉ (Niveau 1) */}
      {historyEmployeeToDelete && (
        <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xl max-w-sm w-full space-y-4">
            <div className="w-10 h-10 rounded-full bg-rose-100 text-rose-700 flex items-center justify-center mx-auto">
              <Trash2 className="w-5 h-5" />
            </div>

            <div className="text-center space-y-1">
              <h4 className="text-sm font-bold text-slate-900">
                Supprimer l'historique de « {historyEmployeeToDelete.name} » ?
              </h4>
              <p className="text-xs text-slate-500">
                Les {historyEmployeeToDelete.count} modification(s) enregistrée(s) pour ce salarié seront définitivement effacées du magasin.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2 pt-2">
              <button
                type="button"
                disabled={isDeletingHistory}
                onClick={() => setHistoryEmployeeToDelete(null)}
                className="py-2 px-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs transition-colors cursor-pointer"
              >
                Annuler
              </button>
              <button
                type="button"
                disabled={isDeletingHistory}
                onClick={handleConfirmDeleteEmployeeHistory}
                className="py-2 px-3 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs shadow-xs transition-colors disabled:opacity-50 cursor-pointer"
              >
                {isDeletingHistory ? 'Suppression...' : 'Supprimer'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: CONFIRMATION PURGE TOTALE HISTORIQUE DU MAGASIN (Niveau 2) */}
      {isPurgeAllHistoryModalOpen && (
        <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xl max-w-sm w-full space-y-4">
            <div className="w-12 h-12 rounded-full bg-rose-100 text-rose-700 flex items-center justify-center mx-auto">
              <AlertTriangle className="w-6 h-6" />
            </div>

            <div className="text-center space-y-1.5">
              <h4 className="text-base font-bold text-slate-900">
                Purger tout l'historique du magasin ?
              </h4>
              <p className="text-xs text-slate-600 leading-relaxed">
                Cette action va supprimer définitivement l'ensemble des <strong>{historyTotalCount} modifications</strong> enregistrées dans l'historique de ce magasin.
              </p>
              <p className="text-[11px] text-rose-600 font-medium">
                Cette opération est irréversible. Les plannings et horaires actuels restent inchangés.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2 pt-2">
              <button
                type="button"
                disabled={isDeletingHistory}
                onClick={() => setIsPurgeAllHistoryModalOpen(false)}
                className="py-2.5 px-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs transition-colors cursor-pointer"
              >
                Annuler
              </button>
              <button
                type="button"
                disabled={isDeletingHistory}
                onClick={handleConfirmPurgeAllHistory}
                className="py-2.5 px-3 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs shadow-xs transition-colors disabled:opacity-50 cursor-pointer"
              >
                {isDeletingHistory ? 'Purge en cours...' : 'Confirmer la purge'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
