import React, { useState, useEffect, useRef } from 'react';
import {
  superAdminLogin,
  superAdminGetStores,
  superAdminCreateStore,
  superAdminUpdateStore,
  superAdminDeleteStore,
  superAdminRestoreStore,
  superAdminResetStore,
  setActiveStore,
} from '../services/api';
import {
  ShieldCheck,
  ShieldAlert,
  KeyRound,
  Store,
  Plus,
  Trash2,
  Edit2,
  Download,
  Upload,
  RotateCcw,
  LogIn,
  Eye,
  EyeOff,
  Check,
  AlertTriangle,
  X,
  Lock,
  Layers,
  Database,
  Calendar,
  Users,
  Copy,
} from 'lucide-react';

interface SuperAdminModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSwitchToStore: (store: { id: string; name: string; token: string }) => void;
}

export const SuperAdminModal: React.FC<SuperAdminModalProps> = ({
  isOpen,
  onClose,
  onSwitchToStore,
}) => {
  // Authentication state
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [passwordInput, setPasswordInput] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [authError, setAuthError] = useState('');
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  // Stores state
  const [stores, setStores] = useState<any[]>([]);
  const [isLoadingStores, setIsLoadingStores] = useState(false);
  const [toastMessage, setToastMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Create store modal
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [newStoreName, setNewStoreName] = useState('');
  const [newStoreToken, setNewStoreToken] = useState('');
  const [newStorePin, setNewStorePin] = useState('000000');
  const [isCreating, setIsCreating] = useState(false);

  // Edit store modal
  const [storeToEdit, setStoreToEdit] = useState<any | null>(null);
  const [editStoreName, setEditStoreName] = useState('');
  const [editStoreToken, setEditStoreToken] = useState('');
  const [editStorePin, setEditStorePin] = useState('');
  const [isUpdating, setIsUpdating] = useState(false);

  // Confirm delete / reset modals
  const [storeToDelete, setStoreToDelete] = useState<any | null>(null);
  const [storeToReset, setStoreToReset] = useState<any | null>(null);
  const [isActionPending, setIsActionPending] = useState(false);

  // File upload for restore
  const [activeStoreForRestore, setActiveStoreForRestore] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const showToast = (type: 'success' | 'error', text: string) => {
    setToastMessage({ type, text });
    setTimeout(() => setToastMessage(null), 3500);
  };

  const loadStores = async () => {
    setIsLoadingStores(true);
    try {
      const res = await superAdminGetStores();
      if (res.success) {
        setStores(res.stores);
      } else {
        showToast('error', res.error || 'Erreur lors du chargement des magasins.');
      }
    } finally {
      setIsLoadingStores(false);
    }
  };

  useEffect(() => {
    if (isOpen && isAuthenticated) {
      loadStores();
    }
  }, [isOpen, isAuthenticated]);

  if (!isOpen) return null;

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!passwordInput.trim()) return;

    setIsLoggingIn(true);
    setAuthError('');
    try {
      const res = await superAdminLogin(passwordInput);
      if (res.success) {
        setIsAuthenticated(true);
        setPasswordInput('');
        loadStores();
      } else {
        setAuthError(res.error || 'Mot de passe incorrect.');
      }
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleCreateStore = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newStoreName.trim() || !newStoreToken.trim()) return;

    setIsCreating(true);
    try {
      const res = await superAdminCreateStore(newStoreName, newStoreToken, newStorePin);
      if (res.success) {
        showToast('success', `Magasin « ${newStoreName} » créé avec succès !`);
        setIsCreateModalOpen(false);
        setNewStoreName('');
        setNewStoreToken('');
        setNewStorePin('000000');
        await loadStores();
      } else {
        showToast('error', res.error || 'Impossible de créer le magasin.');
      }
    } finally {
      setIsCreating(false);
    }
  };

  const handleUpdateStore = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!storeToEdit || !editStoreName.trim() || !editStoreToken.trim()) return;

    setIsUpdating(true);
    try {
      const res = await superAdminUpdateStore(storeToEdit.id, {
        name: editStoreName,
        token: editStoreToken,
        adminPin: editStorePin,
      });
      if (res.success) {
        showToast('success', `Magasin « ${editStoreName} » mis à jour.`);
        setStoreToEdit(null);
        await loadStores();
      } else {
        showToast('error', res.error || 'Impossible de mettre à jour le magasin.');
      }
    } finally {
      setIsUpdating(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!storeToDelete) return;
    setIsActionPending(true);
    try {
      const res = await superAdminDeleteStore(storeToDelete.id);
      if (res.success) {
        showToast('success', `Magasin « ${storeToDelete.name} » supprimé.`);
        setStoreToDelete(null);
        await loadStores();
      } else {
        showToast('error', res.error || 'Impossible de supprimer ce magasin.');
      }
    } finally {
      setIsActionPending(false);
    }
  };

  const handleConfirmReset = async () => {
    if (!storeToReset) return;
    setIsActionPending(true);
    try {
      const res = await superAdminResetStore(storeToReset.id);
      if (res.success) {
        showToast('success', `Le magasin « ${storeToReset.name} » a été réinitialisé à une base vierge.`);
        setStoreToReset(null);
        await loadStores();
      } else {
        showToast('error', res.error || 'Impossible de réinitialiser ce magasin.');
      }
    } finally {
      setIsActionPending(false);
    }
  };

  const triggerRestoreFile = (storeId: string) => {
    setActiveStoreForRestore(storeId);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
      fileInputRef.current.click();
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !activeStoreForRestore) return;

    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const res = await superAdminRestoreStore(activeStoreForRestore, parsed);
      if (res.success) {
        showToast('success', 'Sauvegarde restaurée avec succès pour ce magasin.');
        await loadStores();
      } else {
        showToast('error', res.error || 'Échec de la restauration.');
      }
    } catch (err: any) {
      showToast('error', `Fichier JSON invalide : ${err.message}`);
    } finally {
      setActiveStoreForRestore(null);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard?.writeText(text);
    showToast('success', `Clé « ${text} » copiée dans le presse-papier.`);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-slate-950/80 backdrop-blur-md animate-in fade-in duration-200">
      {/* Hidden File Input for Backup Restore */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        accept=".json"
        className="hidden"
      />

      {/* Toast Notification */}
      {toastMessage && (
        <div
          className={`fixed top-4 right-4 z-60 px-4 py-2.5 rounded-xl text-xs font-semibold shadow-lg flex items-center gap-2 animate-in slide-in-from-top-2 ${
            toastMessage.type === 'success'
              ? 'bg-emerald-600 text-white'
              : 'bg-rose-600 text-white'
          }`}
        >
          {toastMessage.type === 'success' ? (
            <Check className="w-4 h-4 shrink-0" />
          ) : (
            <AlertTriangle className="w-4 h-4 shrink-0" />
          )}
          <span>{toastMessage.text}</span>
        </div>
      )}

      {/* Screen 1: Password Authenticator */}
      {!isAuthenticated ? (
        <div className="bg-slate-900/95 backdrop-blur-xl rounded-3xl p-6 sm:p-8 max-w-md w-full shadow-2xl border border-slate-800 space-y-6 relative text-slate-100">
          <button
            onClick={onClose}
            className="absolute top-5 right-5 p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>

          <div className="text-center space-y-2">
            <div className="w-16 h-16 rounded-2xl bg-slate-950 text-emerald-400 border border-slate-800 flex items-center justify-center mx-auto shadow-lg shadow-black/40">
              <Lock className="w-8 h-8 text-emerald-400" />
            </div>
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-800 text-emerald-300 border border-slate-700 text-xs font-bold">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
              <span>CanoShift Réseau</span>
            </div>
            <h2 className="text-lg font-bold text-white">
              Espace Administration Multi-Magasins
            </h2>
            <p className="text-xs text-slate-400 leading-relaxed max-w-xs mx-auto">
              Saisissez le mot de passe Super-Administrateur.
            </p>
          </div>

          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-300 block">
                Mot de passe Super-Admin :
              </label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  autoFocus
                  placeholder="Mot de passe"
                  value={passwordInput}
                  onChange={(e) => {
                    setPasswordInput(e.target.value);
                    setAuthError('');
                  }}
                  className="w-full px-4 py-3 pr-10 text-sm font-semibold rounded-xl bg-slate-950 border border-slate-700 text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 p-1"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {authError && (
                <div className="flex items-center gap-1.5 text-rose-400 text-xs font-semibold pt-1">
                  <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
                  <span>{authError}</span>
                </div>
              )}
            </div>

            <button
              type="submit"
              disabled={isLoggingIn || !passwordInput.trim()}
              className="w-full py-3 px-4 rounded-xl text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 transition-all flex items-center justify-center gap-2 shadow-lg shadow-emerald-950/50 hover:shadow-xl cursor-pointer"
            >
              {isLoggingIn ? (
                <span>Vérification...</span>
              ) : (
                <>
                  <span>Déverrouiller le Gestionnaire</span>
                  <ShieldCheck className="w-4 h-4 text-white" />
                </>
              )}
            </button>
          </form>

          <div className="p-3 bg-slate-950/70 border border-slate-800 rounded-xl text-[11px] text-slate-400 leading-relaxed">
            <p className="font-semibold text-slate-300 mb-0.5">Sécurité d'accès garantie :</p>
            Ce mot de passe est modifiable exclusivement sur le serveur.
          </div>
        </div>
      ) : (
        /* Screen 2: Multi-Store Dashboard */
        <div className="bg-slate-50 rounded-3xl w-full max-w-5xl max-h-[90vh] shadow-2xl border border-slate-200 flex flex-col overflow-hidden">
          {/* Dashboard Header */}
          <div className="bg-slate-900 text-white p-5 sm:p-6 flex items-center justify-between gap-4 border-b border-slate-800">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-2xl bg-emerald-600/20 border border-emerald-500/30 text-emerald-400 flex items-center justify-center font-bold">
                <Store className="w-6 h-6" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-base sm:text-lg font-bold text-white tracking-tight">
                    Espace Gestionnaire Multi-Magasins
                  </h2>
                  <span className="text-[10px] uppercase font-mono tracking-wider px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-bold">
                    Super-Admin
                  </span>
                </div>
                <p className="text-xs text-slate-400">
                  Création, isolation stricte des données et sauvegardes de chaque magasin
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setIsCreateModalOpen(true)}
                className="py-2 px-3 sm:px-4 rounded-xl text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-500 active:scale-95 transition-all flex items-center gap-1.5 shadow-md shadow-emerald-950/40 cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span className="hidden sm:inline">Nouveau Magasin</span>
                <span className="sm:hidden">Créer</span>
              </button>

              <a
                href="/api/superadmin/backup-all"
                download
                className="py-2 px-3 rounded-xl text-xs font-semibold text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 transition-colors flex items-center gap-1.5 border border-slate-700"
                title="Sauvegarde globale de tout le réseau"
              >
                <Download className="w-3.5 h-3.5 text-emerald-400" />
                <span className="hidden md:inline">Sauvegarde Globale</span>
              </a>

              <button
                onClick={onClose}
                className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Info Ribbon */}
          <div className="bg-emerald-950/40 border-b border-emerald-900/30 px-5 py-2.5 flex items-center justify-between text-xs text-emerald-300 flex-wrap gap-2">
            <div className="flex items-center gap-2" style={{ color: '#2a5e4b' }}>
              <Database className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>
                <strong>{stores.length} magasin(s) configuré(s)</strong> — Chaque magasin dispose de son propre fichier de sauvegarde indépendant dans <code className="font-mono text-white bg-emerald-900/50 px-1 py-0.5 rounded text-[11px]">./data/stores/</code>.
              </span>
            </div>
            <div className="text-[11px] text-emerald-400/80" style={{ color: '#244b3f' }}>
              Protection : <strong>SUPER_ADMIN_PASSWORD (.env)</strong>
            </div>
          </div>

          {/* Stores Grid Content */}
          <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
            {isLoadingStores ? (
              <div className="py-20 text-center space-y-3">
                <div className="w-8 h-8 border-3 border-emerald-600 border-t-transparent rounded-full animate-spin mx-auto" />
                <p className="text-xs text-slate-500 font-medium">Chargement des magasins...</p>
              </div>
            ) : stores.length === 0 ? (
              <div className="py-16 text-center space-y-3 bg-white rounded-2xl border border-slate-200 p-8">
                <Store className="w-10 h-10 text-slate-300 mx-auto" />
                <h3 className="text-sm font-bold text-slate-800">Aucun magasin trouvé</h3>
                <p className="text-xs text-slate-500 max-w-sm mx-auto">
                  Cliquez sur « Nouveau Magasin » pour créer le premier établissement du réseau.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {stores.map((s) => (
                  <div
                    key={s.id}
                    className="bg-white rounded-2xl border border-slate-200/90 hover:border-emerald-500/40 p-5 shadow-xs transition-all space-y-4 flex flex-col justify-between"
                  >
                    {/* Store Title & Badges */}
                    <div className="space-y-2">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-2.5">
                          <div className="w-10 h-10 rounded-xl bg-emerald-50 border border-emerald-100 text-emerald-700 flex items-center justify-center font-bold shrink-0">
                            <Store className="w-5 h-5" />
                          </div>
                          <div>
                            <h3 className="text-sm sm:text-base font-bold text-slate-900">
                              {s.name}
                            </h3>
                            <p className="text-[11px] text-slate-400 font-mono">
                              Fichier : {s.dataFile}
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => {
                              setStoreToEdit(s);
                              setEditStoreName(s.name);
                              setEditStoreToken(s.token);
                              setEditStorePin(s.adminPin || '000000');
                            }}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-emerald-700 hover:bg-emerald-50 transition-colors"
                            title="Modifier ce magasin"
                          >
                            <Edit2 className="w-4 h-4" style={{ color: '#e1190c' }} />
                          </button>

                          {stores.length > 1 && (
                            <button
                              onClick={() => setStoreToDelete(s)}
                              className="p-1.5 rounded-lg text-slate-400 hover:text-rose-700 hover:bg-rose-50 transition-colors"
                              title="Supprimer ce magasin"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Keys and security box */}
                      <div className="bg-slate-50 p-3 rounded-xl border border-slate-100 grid grid-cols-2 gap-3 text-xs">
                        <div>
                          <span className="text-[10px] text-slate-500 font-medium block">
                            Clé d'accès salariés :
                          </span>
                          <div className="flex items-center gap-1 mt-0.5">
                            <span className="font-mono font-bold text-slate-900 bg-white px-2 py-0.5 rounded border border-slate-200">
                              {s.token}
                            </span>
                            <button
                              type="button"
                              onClick={() => copyToClipboard(s.token)}
                              className="text-slate-400 hover:text-slate-700 p-1"
                              title="Copier la clé"
                            >
                              <Copy className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>

                        <div>
                          <span className="text-[10px] text-slate-500 font-medium block">
                            PIN Responsable :
                          </span>
                          <div className="mt-0.5">
                            <span className="font-mono font-bold text-slate-900 bg-white px-2 py-0.5 rounded border border-slate-200">
                              {s.adminPin || '000000'}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Store quick metrics */}
                      {s.stats && (
                        <div className="grid grid-cols-3 gap-2 text-center text-xs pt-1">
                          <div className="bg-slate-50 rounded-lg p-2 border border-slate-100">
                            <span className="text-[10px] text-slate-400 flex items-center justify-center gap-1">
                              <Users className="w-3 h-3 text-emerald-600" />
                              <span>Équipe</span>
                            </span>
                            <span className="font-bold text-slate-800 text-sm">
                              {s.stats.totalEmployees}
                            </span>
                          </div>

                          <div className="bg-slate-50 rounded-lg p-2 border border-slate-100">
                            <span className="text-[10px] text-slate-400 flex items-center justify-center gap-1">
                              <Calendar className="w-3 h-3 text-blue-600" />
                              <span>Mois</span>
                            </span>
                            <span className="font-bold text-slate-800 text-sm">
                              {s.stats.totalMonths}
                            </span>
                          </div>

                          <div className="bg-slate-50 rounded-lg p-2 border border-slate-100">
                            <span className="text-[10px] text-slate-400 flex items-center justify-center gap-1">
                              <Layers className="w-3 h-3 text-purple-600" />
                              <span>Changements</span>
                            </span>
                            <span className="font-bold text-slate-800 text-sm">
                              {s.stats.totalChanges}
                            </span>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Actions Toolbar */}
                    <div className="pt-2 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2">
                      <button
                        onClick={() => {
                          setActiveStore(s);
                          onSwitchToStore(s);
                          onClose();
                        }}
                        className="py-2 px-3 rounded-xl text-xs font-bold text-white bg-emerald-700 hover:bg-emerald-800 active:scale-95 transition-all flex items-center gap-1.5 shadow-xs cursor-pointer"
                      >
                        <LogIn className="w-3.5 h-3.5" />
                        <span>Ouvrir ce magasin</span>
                      </button>

                      <div className="flex items-center gap-1.5">
                        <a
                          href={`/api/superadmin/stores/${s.id}/backup`}
                          download
                          className="py-1.5 px-2.5 rounded-lg text-xs font-semibold text-slate-700 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 transition-colors flex items-center gap-1"
                          title="Télécharger la sauvegarde complète de ce magasin"
                        >
                          <Download className="w-3.5 h-3.5 text-emerald-600" />
                          <span>Sauvegarde</span>
                        </a>

                        <button
                          type="button"
                          onClick={() => triggerRestoreFile(s.id)}
                          className="py-1.5 px-2.5 rounded-lg text-xs font-semibold text-slate-700 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 transition-colors flex items-center gap-1"
                          title="Restaurer un fichier de sauvegarde"
                        >
                          <Upload className="w-3.5 h-3.5 text-blue-600" />
                          <span>Restaurer</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => setStoreToReset(s)}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-rose-700 hover:bg-rose-50 transition-colors"
                          title="Remise à zéro des plannings (base vierge)"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* MODAL 1: CREATE STORE */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-6 shadow-2xl max-w-md w-full space-y-5 text-slate-900 dark:text-white transition-colors">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-emerald-100 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-300 flex items-center justify-center font-bold">
                  <Plus className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-slate-900 dark:text-white">Nouveau Magasin</h4>
                  <p className="text-xs text-slate-500 dark:text-slate-400">Ajouter un établissement indépendant</p>
                </div>
              </div>
              <button
                onClick={() => setIsCreateModalOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateStore} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-800 dark:text-slate-200 mb-1">
                  Nom du magasin / établissement :
                </label>
                <input
                  type="text"
                  required
                  placeholder="Ex: Magasin Lyon Centre"
                  value={newStoreName}
                  onChange={(e) => setNewStoreName(e.target.value)}
                  className="w-full text-xs font-bold text-slate-900 dark:text-white bg-white dark:bg-slate-950 px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:border-transparent shadow-xs"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-800 dark:text-slate-200 mb-1">
                  Clé d'accès salariés (unique) :
                </label>
                <input
                  type="text"
                  required
                  placeholder="Ex: LYON2026"
                  value={newStoreToken}
                  onChange={(e) => setNewStoreToken(e.target.value.toUpperCase())}
                  className="w-full text-xs font-mono uppercase font-black text-slate-900 dark:text-white bg-white dark:bg-slate-950 px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:border-transparent shadow-xs"
                />
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                  Cette clé permettra d'accéder directement à ce magasin depuis l'écran d'accueil.
                </p>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-800 dark:text-slate-200 mb-1">
                  Code PIN administrateur initial (6 chiffres) :
                </label>
                <input
                  type="password"
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="000000"
                  value={newStorePin}
                  onChange={(e) => setNewStorePin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  className="w-full text-xs font-mono font-bold text-slate-900 dark:text-white bg-white dark:bg-slate-950 px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-600 text-center tracking-widest shadow-xs"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsCreateModalOpen(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-xl transition-colors"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={isCreating || !newStoreName.trim() || !newStoreToken.trim()}
                  className="px-4 py-2 text-xs font-bold text-white bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 rounded-xl transition-colors shadow-xs"
                >
                  {isCreating ? 'Création en cours...' : 'Créer le magasin'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: EDIT STORE */}
      {storeToEdit && (
        <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-6 shadow-2xl max-w-md w-full space-y-5 text-slate-900 dark:text-white transition-colors">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-blue-100 dark:bg-blue-950/80 text-blue-800 dark:text-blue-300 flex items-center justify-center font-bold">
                  <Edit2 className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-slate-900 dark:text-white">Modifier le magasin</h4>
                  <p className="text-xs text-slate-500 dark:text-slate-400">Mettre à jour le nom, la clé ou le PIN</p>
                </div>
              </div>
              <button
                onClick={() => setStoreToEdit(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleUpdateStore} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-800 dark:text-slate-200 mb-1">
                  Nom du magasin :
                </label>
                <input
                  type="text"
                  required
                  value={editStoreName}
                  onChange={(e) => setEditStoreName(e.target.value)}
                  className="w-full text-xs font-bold text-slate-900 dark:text-white bg-white dark:bg-slate-950 px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-600 shadow-xs"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-800 dark:text-slate-200 mb-1">
                  Clé d'accès salariés (unique) :
                </label>
                <input
                  type="text"
                  required
                  value={editStoreToken}
                  onChange={(e) => setEditStoreToken(e.target.value.toUpperCase())}
                  className="w-full text-xs font-mono uppercase font-black text-slate-900 dark:text-white bg-white dark:bg-slate-950 px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-600 shadow-xs"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-800 dark:text-slate-200 mb-1">
                  Code PIN administrateur (6 chiffres) :
                </label>
                <input
                  type="password"
                  inputMode="numeric"
                  maxLength={6}
                  value={editStorePin}
                  onChange={(e) => setEditStorePin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  className="w-full text-xs font-mono font-bold text-slate-900 dark:text-white bg-white dark:bg-slate-950 px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-600 text-center tracking-widest shadow-xs"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setStoreToEdit(null)}
                  className="px-4 py-2 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-xl transition-colors"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={isUpdating || !editStoreName.trim() || !editStoreToken.trim()}
                  className="px-4 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-xl transition-colors shadow-xs"
                >
                  {isUpdating ? 'Enregistrement...' : 'Enregistrer les modifications'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 3: CONFIRM DELETE STORE */}
      {storeToDelete && (
        <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-6 shadow-2xl max-w-sm w-full space-y-4 text-center transition-colors">
            <div className="w-12 h-12 rounded-2xl bg-rose-100 dark:bg-rose-950/80 text-rose-700 dark:text-rose-300 flex items-center justify-center mx-auto">
              <Trash2 className="w-6 h-6" />
            </div>

            <div className="space-y-1">
              <h4 className="text-base font-bold text-slate-900 dark:text-white">
                Supprimer le magasin « {storeToDelete.name} » ?
              </h4>
              <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                Toutes les données de ce magasin ({storeToDelete.dataFile}) seront définitivement effacées du serveur.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2 pt-2">
              <button
                type="button"
                onClick={() => setStoreToDelete(null)}
                className="py-2.5 px-3 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-semibold text-xs transition-colors"
              >
                Annuler
              </button>
              <button
                type="button"
                disabled={isActionPending}
                onClick={handleConfirmDelete}
                className="py-2.5 px-3 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs shadow-xs transition-colors disabled:opacity-50"
              >
                {isActionPending ? 'Suppression...' : 'Supprimer'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 4: CONFIRM RESET STORE */}
      {storeToReset && (
        <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-6 shadow-2xl max-w-sm w-full space-y-4 text-center transition-colors">
            <div className="w-12 h-12 rounded-2xl bg-amber-100 dark:bg-amber-950/80 text-amber-800 dark:text-amber-300 flex items-center justify-center mx-auto">
              <RotateCcw className="w-6 h-6" />
            </div>

            <div className="space-y-1">
              <h4 className="text-base font-bold text-slate-900 dark:text-white">
                Remise à zéro de « {storeToReset.name} » ?
              </h4>
              <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                Tous les plannings et saisies de ce magasin seront effacés pour repartir sur une base vierge. Le nom et la clé d'accès seront conservés.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2 pt-2">
              <button
                type="button"
                onClick={() => setStoreToReset(null)}
                className="py-2.5 px-3 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-semibold text-xs transition-colors"
              >
                Annuler
              </button>
              <button
                type="button"
                disabled={isActionPending}
                onClick={handleConfirmReset}
                className="py-2.5 px-3 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs shadow-xs transition-colors disabled:opacity-50"
              >
                {isActionPending ? 'Réinitialisation...' : 'Confirmer'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
