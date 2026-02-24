
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  MapPin, 
  LogOut, 
  CheckCircle, 
  Bell,
  ShieldAlert, 
  AlertTriangle, 
  PhoneCall, 
  Loader2, 
  Wifi, 
  RefreshCw, 
  Globe,
  Navigation,
  Activity,
  Calendar,
  ChevronRight,
  ShieldCheck,
  Zap
} from 'lucide-react';
import { db } from '../../services/databaseService';
import { googleSheetService } from '../../services/googleSheetService';
import { Program, User, Attendance, Notification } from '../../types';
import { CHECKPOINTS, MALAYSIAN_STATES } from '../../constants';
import { formatTacticalTime } from '../../App';

interface TaskCheckInProps {
  user: User;
  onTaskLogin: (task: Attendance) => void;
  onLogout: () => void;
}

const TaskCheckIn: React.FC<TaskCheckInProps> = ({ user, onTaskLogin, onLogout }) => {
  const [programs, setPrograms] = useState<Program[]>([]);
  const [selectedProgramId, setSelectedProgramId] = useState('');
  const [selectedCheckpoint, setSelectedCheckpoint] = useState('');
  const [location, setLocation] = useState<{lat: number, lng: number} | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [programLevelMode, setProgramLevelMode] = useState<'Negeri' | 'Pusat'>('Negeri');
  const [isManualMode, setIsManualMode] = useState(false);
  const [manualProgramName, setManualProgramName] = useState('');
  const [manualCheckpoint, setManualCheckpoint] = useState('');
  const [manualState, setManualState] = useState(user.state);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [pendingAttendance, setPendingAttendance] = useState<Attendance | null>(null);
  const [toast, setToast] = useState<{ message: string, type: 'success' | 'info' } | null>(null);
  
  const navigate = useNavigate();

  const showToast = (message: string, type: 'success' | 'info' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const fetchPrograms = async (forceCloud = false) => {
    if (forceCloud) setIsSyncing(true);
    else setIsLoading(true);

    try {
      let activePrograms: Program[] = [];
      const targetState = programLevelMode === 'Pusat' ? 'CENTER' : user.state;
      
      if (forceCloud) {
        // Pull fresh data from Master HQ for the selected target state/center
        const cloudData = await googleSheetService.fetchProgramsByState(targetState);
        // Update local DB with fresh data
        for (const p of cloudData) {
          const existing = await db.getPrograms();
          if (!existing.some(ep => ep.id === p.id)) {
            await db.addProgram(p);
          } else {
            await db.updateProgram(p);
          }
        }
        activePrograms = cloudData.filter(p => p.status === 'Active');
      } else {
        // Load from local
        const localData = await db.getPrograms(targetState);
        activePrograms = localData.filter(p => p.status === 'Active');
      }

      setPrograms(activePrograms);
      setSelectedProgramId(''); // Reset selection when level changes
      
      // Auto-select if only one program
      if (activePrograms.length === 1) {
        setSelectedProgramId(activePrograms[0].id);
      }
    } catch (err) {
      console.error("Failed to fetch programs:", err);
    } finally {
      setIsLoading(false);
      setIsSyncing(false);
    }
  };

  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => setLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => console.warn('GPS Signal unavailable.')
      );
    }
    fetchPrograms();
  }, [user.state, programLevelMode]);

  const handleCheckIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    
    const program = programs.find(p => p.id === selectedProgramId);
    const finalProgramId = isManualMode ? `MANUAL_${Date.now()}` : selectedProgramId;
    const finalProgramName = isManualMode ? manualProgramName : (program?.name || selectedProgramId);
    const finalCheckpoint = isManualMode ? manualCheckpoint : selectedCheckpoint;
    const finalState = isManualMode ? manualState : (program?.state || user.state);
    
    const finalLocation = location || { lat: 0, lng: 0 };
    const entryTimeUTC = new Date().toISOString();
    const entryTimeMY = formatTacticalTime(entryTimeUTC);

    const attendance: Attendance = {
      id: `ATT_${Date.now()}`,
      programId: finalProgramId,
      programName: finalProgramName,
      state: finalState,
      responderId: user.id,
      responderName: user.name,
      checkpoint: finalCheckpoint,
      entryTime: entryTimeMY,
      location: finalLocation,
      remark: 'ACTIVE'
    };

    setPendingAttendance(attendance);
    setShowConfirmModal(true);
    setIsSubmitting(false);
  };

  const confirmCheckIn = async () => {
    if (!pendingAttendance) return;
    setIsSubmitting(true);
    setShowConfirmModal(false);

    try {
      // 1. Save Locally
      await db.addAttendance(pendingAttendance);

      // 2. Notification (Local)
      const notification: Notification = {
        id: `NOTIF_${Date.now()}`,
        programId: pendingAttendance.programId,
        senderName: user.name,
        message: `${user.name} lapor diri di ${pendingAttendance.checkpoint} pada ${pendingAttendance.entryTime}`,
        timestamp: new Date().toISOString(),
        type: 'attendance'
      };
      await db.addNotification(notification);

      // 3. Cloud Sync
      await googleSheetService.syncData(user.spreadsheetId, [{
        type: 'attendance',
        payload: {
          id: pendingAttendance.id,
          responderId: pendingAttendance.responderId,
          responderName: pendingAttendance.responderName,
          programName: pendingAttendance.programName,
          checkpoint: pendingAttendance.checkpoint,
          entryTime: pendingAttendance.entryTime,
          exitTime: '', 
          lat: pendingAttendance.location.lat,
          lng: pendingAttendance.location.lng,
          remark: 'ACTIVE'
        }
      }]);

      onTaskLogin(pendingAttendance);
      showToast("Check-in Berjaya! Memulakan Sesi...", "success");
      setTimeout(() => navigate('/'), 1500);
    } catch (err) {
      console.error("Cloud Sync Failed:", err);
      onTaskLogin(pendingAttendance);
      showToast("Check-in Berjaya (Offline Mode)", "info");
      setTimeout(() => navigate('/'), 1500);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-inter">
      {toast && (
        <div className="fixed top-10 left-1/2 -translate-x-1/2 z-[200] animate-in slide-in-from-top-10 fade-in duration-300 w-[90%] max-w-sm text-center">
          <div className={`px-5 py-4 rounded-2xl shadow-2xl flex items-center justify-center gap-3 border ${toast.type === 'success' ? 'bg-green-600 border-green-500' : 'bg-slate-800 border-slate-700'} text-white`}>
            {toast.type === 'success' ? <CheckCircle className="w-5 h-5" /> : <Bell className="w-5 h-5" />}
            <p className="font-bold text-xs">{toast.message}</p>
          </div>
        </div>
      )}
      <header className="bg-red-600 text-white p-6 shadow-2xl relative overflow-hidden">
        <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full blur-2xl -translate-y-1/2 translate-x-1/2"></div>
        
        <div className="flex justify-between items-center max-w-2xl mx-auto w-full relative z-10">
          <div>
            <h1 className="text-2xl font-black tracking-tighter uppercase italic leading-none mb-1">resQ Check-In</h1>
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse"></div>
              <p className="text-red-100 text-[9px] font-black uppercase tracking-widest opacity-90">
                Petugas: {user.name} • {user.state}
              </p>
            </div>
          </div>
          <button onClick={onLogout} className="p-3 bg-red-700/50 hover:bg-red-800 rounded-2xl transition-all shadow-lg">
            <LogOut className="w-5 h-5" />
          </button>
        </div>
      </header>

      <main className="flex-1 p-6 flex flex-col items-center justify-center -mt-8">
        <div className="max-w-md w-full bg-white rounded-[3rem] shadow-2xl p-8 border border-white/10 relative overflow-hidden">
          {isSubmitting && (
            <div className="absolute inset-0 bg-white/95 backdrop-blur-md z-50 flex flex-col items-center justify-center">
               <Loader2 className="w-16 h-16 text-red-600 animate-spin mb-4" />
               <p className="font-black text-slate-800 text-[10px] uppercase tracking-[0.4em]">Mengesahkan Protokol...</p>
            </div>
          )}

          <div className="mb-8 flex justify-between items-center px-2">
             <div className="flex items-center gap-3">
                <div className="p-2.5 bg-slate-100 text-slate-500 rounded-xl">
                  <Navigation className="w-4 h-4" />
                </div>
                <div>
                   <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest leading-none mb-1">Lokasi Semasa</p>
                   <p className="text-[9px] font-bold text-slate-600 uppercase">
                    {location ? `${location.lat.toFixed(4)}, ${location.lng.toFixed(4)}` : 'Mencari GPS...'}
                   </p>
                </div>
             </div>
             <button 
                onClick={() => fetchPrograms(true)} 
                disabled={isSyncing}
                className="p-3 bg-indigo-50 text-indigo-600 rounded-2xl hover:bg-indigo-600 hover:text-white transition-all shadow-sm flex items-center gap-2 group"
              >
                <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin' : 'group-hover:rotate-180 transition-transform'}`} />
                <span className="text-[8px] font-black uppercase tracking-widest">Sync HQ</span>
             </button>
          </div>

          {/* New Level Selection Toggle */}
          <div className="mb-8">
             <div className="flex justify-between items-center mb-3 ml-2">
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest">Pilih Mod Program</label>
                <button 
                  type="button"
                  onClick={() => setIsManualMode(!isManualMode)}
                  className={`flex items-center gap-1.5 text-[9px] font-black uppercase tracking-widest px-3 py-1.5 rounded-full border transition-all ${
                    isManualMode ? 'bg-amber-500 text-white border-amber-400 shadow-lg shadow-amber-200' : 'bg-slate-100 text-slate-500 border-slate-200'
                  }`}
                >
                  {isManualMode ? <Zap className="w-3 h-3 fill-current" /> : <Activity className="w-3 h-3" />}
                  {isManualMode ? 'Batal Manual' : 'Input Manual'}
                </button>
             </div>
             {!isManualMode && (
               <div className="flex p-1.5 bg-slate-100 rounded-[1.5rem] gap-1 shadow-inner">
                  <button 
                    onClick={() => setProgramLevelMode('Negeri')}
                    className={`flex-1 flex items-center justify-center gap-2 py-3.5 rounded-[1.2rem] text-[10px] font-black uppercase tracking-widest transition-all ${
                      programLevelMode === 'Negeri' ? 'bg-white text-red-600 shadow-xl' : 'text-slate-500 hover:bg-slate-200/50'
                    }`}
                  >
                    <MapPin className="w-4 h-4" /> Program Negeri
                  </button>
                  <button 
                    onClick={() => setProgramLevelMode('Pusat')}
                    className={`flex-1 flex items-center justify-center gap-2 py-3.5 rounded-[1.2rem] text-[10px] font-black uppercase tracking-widest transition-all ${
                      programLevelMode === 'Pusat' ? 'bg-indigo-600 text-white shadow-xl' : 'text-slate-500 hover:bg-slate-200/50'
                    }`}
                  >
                    <Globe className="w-4 h-4" /> Program Pusat
                  </button>
               </div>
             )}
          </div>

          {isManualMode ? (
            <form onSubmit={handleCheckIn} className="space-y-6 animate-in slide-in-from-bottom-4 duration-500">
               <div className="space-y-4">
                  <div className="relative">
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-2">Nama Program</label>
                    <div className="relative">
                      <Activity className="absolute left-5 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-300" />
                      <input 
                        type="text" 
                        value={manualProgramName} 
                        onChange={(e) => setManualProgramName(e.target.value)}
                        placeholder="Cth: Larian Amal 2026"
                        className="w-full pl-14 pr-6 py-4 rounded-2xl border border-slate-100 bg-slate-50 font-bold text-sm outline-none focus:ring-4 focus:ring-amber-500/10 focus:border-amber-500 transition-all"
                        required
                      />
                    </div>
                  </div>
                  <div className="relative">
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-2">Lokasi / Checkpoint</label>
                    <div className="relative">
                      <MapPin className="absolute left-5 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-300" />
                      <input 
                        type="text" 
                        value={manualCheckpoint} 
                        onChange={(e) => setManualCheckpoint(e.target.value)}
                        placeholder="Cth: Water Station 3"
                        className="w-full pl-14 pr-6 py-4 rounded-2xl border border-slate-100 bg-slate-50 font-bold text-sm outline-none focus:ring-4 focus:ring-amber-500/10 focus:border-amber-500 transition-all"
                        required
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-2">Negeri Tugasan</label>
                    <div className="relative">
                      <Globe className="absolute left-5 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-300" />
                      <select 
                        value={manualState} 
                        onChange={(e) => setManualState(e.target.value)}
                        className="w-full pl-14 pr-6 py-4 rounded-2xl border border-slate-100 bg-slate-50 font-bold text-sm outline-none appearance-none"
                        required
                      >
                        {MALAYSIAN_STATES.map(s => <option key={s.abbr} value={s.name}>{s.name}</option>)}
                      </select>
                    </div>
                  </div>
               </div>

               <button
                  type="submit"
                  disabled={!manualProgramName || !manualCheckpoint || isSubmitting}
                  className={`w-full py-6 rounded-[2.5rem] text-white font-black text-xl shadow-2xl flex items-center justify-center gap-4 transition-all transform active:scale-95 ${
                    manualProgramName && manualCheckpoint 
                      ? 'bg-amber-600 hover:bg-amber-700 shadow-amber-200' 
                      : 'bg-slate-200 cursor-not-allowed text-slate-400'
                  }`}
                >
                  <CheckCircle className="w-7 h-7" />
                  Mula Tugas (Manual)
                </button>
            </form>
          ) : isLoading ? (
            <div className="py-20 text-center">
               <Loader2 className="w-12 h-12 text-slate-200 animate-spin mx-auto mb-4" />
               <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Memuat Acara {programLevelMode}...</p>
            </div>
          ) : programs.length === 0 ? (
            <div className="text-center py-10 space-y-6 animate-in fade-in zoom-in-95 duration-500">
              <div className="w-24 h-24 bg-amber-50 rounded-full flex items-center justify-center mx-auto mb-4 border-4 border-white shadow-inner">
                <AlertTriangle className="w-12 h-12 text-amber-500" />
              </div>
              <div className="space-y-2">
                <h2 className="text-xl font-black text-slate-800 uppercase tracking-tighter italic">Tiada Program Aktif</h2>
                <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest px-6">
                  {programLevelMode === 'Pusat' 
                    ? 'HQ MECC Pusat belum melancarkan program nasional.' 
                    : `MECC ${user.state} belum mengaktifkan program negeri.`}
                </p>
              </div>
              <button 
                onClick={() => fetchPrograms(true)} 
                className="w-full py-5 bg-slate-900 text-white font-black text-[10px] uppercase tracking-[0.2em] rounded-3xl shadow-xl flex items-center justify-center gap-3"
              >
                <RefreshCw className="w-4 h-4" /> Cuba Semak Semula
              </button>
            </div>
          ) : (
            <form onSubmit={handleCheckIn} className="space-y-8 animate-in slide-in-from-bottom-4 duration-500">
              <div className="space-y-6">
                <div>
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3 ml-2">Pilih Acara ({programLevelMode})</label>
                  <div className="grid grid-cols-1 gap-3 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
                    {programs.map(p => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => setSelectedProgramId(p.id)}
                        className={`w-full p-6 rounded-[2rem] border-2 text-left transition-all relative overflow-hidden group ${
                          selectedProgramId === p.id 
                            ? 'border-red-600 bg-red-50 ring-4 ring-red-500/5 shadow-lg' 
                            : 'border-slate-100 bg-slate-50 hover:border-slate-200'
                        }`}
                      >
                        <div className="flex justify-between items-center mb-1">
                          <h3 className={`font-black uppercase text-sm tracking-tight ${selectedProgramId === p.id ? 'text-red-900' : 'text-slate-800'}`}>
                            {p.name}
                          </h3>
                          <ChevronRight className={`w-4 h-4 transition-transform ${selectedProgramId === p.id ? 'text-red-600 translate-x-1' : 'text-slate-300'}`} />
                        </div>
                        <div className="flex items-center gap-4 text-[9px] font-bold text-slate-400 uppercase tracking-widest">
                          <span className="flex items-center gap-1"><Calendar className="w-3 h-3 text-red-400" /> {p.date}</span>
                          <span className="flex items-center gap-1"><MapPin className="w-3 h-3 text-blue-400" /> {p.location}</span>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3 ml-2">Pilih Stesen Tugasan</label>
                  <div className="relative group">
                    <select
                      value={selectedCheckpoint}
                      onChange={(e) => setSelectedCheckpoint(e.target.value)}
                      className="w-full px-6 py-5 rounded-[2rem] border border-slate-100 bg-slate-50 focus:ring-4 focus:ring-red-500/10 focus:border-red-600 focus:bg-white outline-none font-black text-slate-800 text-sm transition-all appearance-none cursor-pointer"
                      required
                    >
                      <option value="">-- PILIH CHECKPOINT --</option>
                      {CHECKPOINTS.map(cp => (
                        <option key={cp} value={cp}>{cp.toUpperCase()}</option>
                      ))}
                    </select>
                    <div className="absolute right-6 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400 group-hover:text-red-500 transition-colors">
                      <ChevronRight className="w-5 h-5 rotate-90" />
                    </div>
                  </div>
                </div>
              </div>

              <div className="pt-2">
                <button
                  type="submit"
                  disabled={!selectedProgramId || !selectedCheckpoint || isSubmitting}
                  className={`w-full py-6 rounded-[2.5rem] text-white font-black text-xl shadow-2xl flex items-center justify-center gap-4 transition-all transform active:scale-95 ${
                    selectedProgramId && selectedCheckpoint 
                      ? 'bg-red-600 hover:bg-red-700 shadow-red-200' 
                      : 'bg-slate-200 cursor-not-allowed text-slate-400'
                  }`}
                >
                  <CheckCircle className="w-7 h-7" />
                  Mula Tugas
                </button>
              </div>

              <div className="bg-slate-50 rounded-2xl p-4 flex items-center justify-between border border-slate-100">
                <div className="flex items-center gap-3">
                   <div className={`w-3 h-3 rounded-full ${location ? 'bg-green-500' : 'bg-red-500 animate-pulse'}`}></div>
                   <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">
                    {location ? 'Isyarat GPS Aktif' : 'Mencari Lokasi...'}
                   </p>
                </div>
                <div className="flex items-center gap-2 px-3 py-1 bg-white rounded-xl shadow-sm border border-slate-100">
                   <Wifi className="w-3 h-3 text-green-500" />
                   <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest">HQ Master Sync</span>
                </div>
              </div>
            </form>
          )}
        </div>
      </main>
      
      <footer className="p-10 text-center opacity-30 mt-auto">
        <p className="text-[9px] font-black uppercase tracking-[0.6em] text-slate-500">resQ Amal Tactical Protocol v3.7</p>
      </footer>

      {/* Confirmation Modal */}
      {showConfirmModal && pendingAttendance && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-slate-900/80 backdrop-blur-sm animate-in fade-in duration-300">
          <div className="bg-white w-full max-w-sm rounded-[2.5rem] shadow-2xl overflow-hidden animate-in zoom-in-95 duration-300">
            <div className="bg-red-600 p-8 text-white text-center relative">
               <div className="absolute top-0 left-0 w-full h-full bg-[radial-gradient(circle_at_top_right,_var(--tw-gradient-stops))] from-white/20 to-transparent"></div>
               <ShieldCheck className="w-16 h-16 mx-auto mb-4 relative z-10" />
               <h2 className="text-2xl font-black uppercase italic tracking-tighter relative z-10">Sahkan Tugasan</h2>
            </div>
            <div className="p-8 space-y-6">
               <div className="space-y-4">
                  <div className="flex items-start gap-4">
                    <div className="p-2 bg-slate-100 rounded-xl text-slate-400">
                      <Activity className="w-4 h-4" />
                    </div>
                    <div>
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-0.5">Program</p>
                      <p className="font-bold text-slate-800">{pendingAttendance.programName}</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-4">
                    <div className="p-2 bg-slate-100 rounded-xl text-slate-400">
                      <MapPin className="w-4 h-4" />
                    </div>
                    <div>
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-0.5">Checkpoint</p>
                      <p className="font-bold text-slate-800">{pendingAttendance.checkpoint}</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-4">
                    <div className="p-2 bg-slate-100 rounded-xl text-slate-400">
                      <Globe className="w-4 h-4" />
                    </div>
                    <div>
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-0.5">Negeri</p>
                      <p className="font-bold text-slate-800">{pendingAttendance.state}</p>
                    </div>
                  </div>
               </div>

               <div className="flex gap-3 pt-4">
                  <button 
                    onClick={() => setShowConfirmModal(false)}
                    className="flex-1 py-4 rounded-2xl bg-slate-100 text-slate-500 font-black text-[10px] uppercase tracking-widest hover:bg-slate-200 transition-all"
                  >
                    Batal
                  </button>
                  <button 
                    onClick={confirmCheckIn}
                    className="flex-1 py-4 rounded-2xl bg-red-600 text-white font-black text-[10px] uppercase tracking-widest shadow-lg shadow-red-200 hover:bg-red-700 transition-all flex items-center justify-center gap-2"
                  >
                    <CheckCircle className="w-4 h-4" /> Sahkan
                  </button>
               </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TaskCheckIn;
