import React, { useState, useRef } from 'react';
import { useNetwork } from '../../context/NetworkContext';
import type { EquipmentImage, ImageAnnotation } from '@fibergis/shared';
import { X, Camera, Upload, Trash2, Crosshair } from 'lucide-react';

export const TerminalBoxModal: React.FC = () => {
  const {
    isTerminalBoxModalOpen,
    setIsTerminalBoxModalOpen,
    equipments,
    selectedObject,
    splitters,
    uploadEquipmentPhoto,
    saveImageAnnotation,
    deleteImageAnnotation,
  } = useNetwork();

  // Find target terminal box (from selected object or first FAT)
  const targetTerminal =
    (selectedObject?.type === 'equipment' &&
    (selectedObject.data.type === 'FAT' || selectedObject.data.type.includes('Terminal Box'))
      ? selectedObject.data
      : equipments.find((e) => e.type === 'FAT')) || equipments[0];

  const [activeTab, setActiveTab] = useState<'overview' | 'ports' | 'photos' | 'maintenance' | 'audit'>('photos');
  const [selectedImageIndex, setSelectedImageIndex] = useState(0);

  // Annotation Tool state
  const [isAnnotating, setIsAnnotating] = useState(false);
  const annotationType = 'port_circle' as const;
  const [newAnnotationLabel, setNewAnnotationLabel] = useState('Port 04 (FREE)');
  const [newAnnotationStatus, setNewAnnotationStatus] = useState<'Available' | 'Occupied' | 'Reserved' | 'Faulty'>(
    'Available',
  );
  const [newAnnotationPortNum, setNewAnnotationPortNum] = useState<number>(4);

  // Photo upload form state
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);
  const [photoName, setPhotoName] = useState('');
  const [photoCategory, setPhotoCategory] = useState<EquipmentImage['category']>('Internal Trays');
  const photoDesc = '';

  const imageContainerRef = useRef<HTMLDivElement>(null);

  if (!isTerminalBoxModalOpen) return null;

  const currentImage: EquipmentImage | undefined =
    targetTerminal.images?.[selectedImageIndex] || targetTerminal.images?.[0];
  const terminalSplitter = splitters.find((s) => s.terminalBoxId === targetTerminal.id);

  // Handle clicking on image to add annotation
  const handleImageClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isAnnotating || !currentImage || !imageContainerRef.current) return;

    const rect = imageContainerRef.current.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;

    const newAnno: ImageAnnotation = {
      id: `ANN-${Date.now()}`,
      type: annotationType,
      x: Math.round(x),
      y: Math.round(y),
      label: newAnnotationLabel || `Port ${newAnnotationPortNum}`,
      portNumber: newAnnotationPortNum,
      status: newAnnotationStatus,
      remarks: `Marked by Field Technician at [${x.toFixed(1)}%, ${y.toFixed(1)}%]`,
    };

    saveImageAnnotation(targetTerminal.id, currentImage.id, newAnno);
    setNewAnnotationPortNum((prev) => prev + 1);
    setNewAnnotationLabel(`Port ${(newAnnotationPortNum + 1).toString().padStart(2, '0')}`);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      uploadEquipmentPhoto(targetTerminal.id, {
        name: photoName || file.name,
        category: photoCategory,
        description: photoDesc || 'Technician field inspection upload',
        url: result,
        uploadedBy: 'Current Operator',
        annotations: [],
      });
      setIsUploadingPhoto(false);
      setPhotoName('');
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="fixed inset-0 z-[1000] bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in select-none">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-4xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="px-6 py-3.5 border-b border-slate-100 flex items-center justify-between bg-slate-50/70">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-emerald-600 text-white flex items-center justify-center shadow-xs">
              <Camera className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-bold text-sm text-slate-900">{targetTerminal.name}</h2>
                <span className="font-mono text-[10px] font-bold bg-blue-50 text-blue-700 px-1.5 py-0.2 rounded border border-blue-200/60">
                  {targetTerminal.id}
                </span>
                <span className="text-[10px] font-bold bg-emerald-100 text-emerald-800 px-2 py-0.2 rounded-full">
                  {targetTerminal.status}
                </span>
              </div>
              <p className="text-[11px] text-slate-500">
                {targetTerminal.type} &bull; {targetTerminal.street}, {targetTerminal.area}{' '}
                {targetTerminal.poleNumber ? `(Mounted on ${targetTerminal.poleNumber})` : ''}
              </p>
            </div>
          </div>

          <button
            onClick={() => setIsTerminalBoxModalOpen(false)}
            className="p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-200 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Strip */}
        <div className="px-6 py-2 border-b border-slate-100 flex items-center gap-1 bg-slate-100/50 text-xs">
          {[
            { id: 'photos', label: 'Field Photographs & Annotator', count: targetTerminal.images?.length || 0 },
            { id: 'ports', label: 'Port Management (Splitter 1:8)', count: targetTerminal.totalPorts || 8 },
            { id: 'overview', label: 'Technical Overview' },
            { id: 'maintenance', label: 'Maintenance Log' },
          ].map((t) => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id as any)}
              className={`px-3 py-1.5 rounded-lg font-semibold transition-all flex items-center gap-1.5 ${
                activeTab === t.id
                  ? 'bg-white text-blue-700 shadow-xs border border-slate-200'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/50'
              }`}
            >
              <span>{t.label}</span>
              {t.count !== undefined && (
                <span className="text-[10px] font-mono px-1.5 py-0.2 rounded-full bg-slate-100 text-slate-600">
                  {t.count}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* TAB 1: PHOTOGRAPHS & INTERACTIVE ANNOTATION */}
          {activeTab === 'photos' && (
            <div className="space-y-4">
              {/* Photo Selector & Upload Bar */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 overflow-x-auto pb-1">
                  {targetTerminal.images?.map((img: EquipmentImage, idx: number) => (
                    <button
                      key={img.id}
                      onClick={() => setSelectedImageIndex(idx)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all flex items-center gap-1.5 ${
                        selectedImageIndex === idx
                          ? 'bg-blue-600 text-white border-blue-600 shadow-xs'
                          : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      <Camera className="w-3.5 h-3.5" />
                      <span>{img.category}</span>
                      <span className="text-[10px] opacity-75">({img.annotations.length})</span>
                    </button>
                  ))}
                </div>

                <button
                  onClick={() => setIsUploadingPhoto(!isUploadingPhoto)}
                  className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold shadow-xs flex items-center gap-1.5 transition-colors shrink-0"
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>Upload New Photo</span>
                </button>
              </div>

              {/* Upload Dropzone Form if toggled */}
              {isUploadingPhoto && (
                <div className="p-4 bg-emerald-50/60 rounded-xl border border-emerald-200 space-y-3 animate-in fade-in">
                  <div className="font-bold text-xs text-emerald-900">Upload Terminal Field Photograph</div>
                  <div className="grid grid-cols-3 gap-3 text-xs">
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-600 mb-1">Image Label</label>
                      <input
                        type="text"
                        placeholder="e.g. Front Door Open View"
                        value={photoName}
                        onChange={(e) => setPhotoName(e.target.value)}
                        className="w-full px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-600 mb-1">Category</label>
                      <select
                        value={photoCategory}
                        onChange={(e) => setPhotoCategory(e.target.value as any)}
                        className="w-full px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg outline-none"
                      >
                        <option value="Front View">Front View</option>
                        <option value="Internal Trays">Internal Splice Trays</option>
                        <option value="Splitter Layout">Splitter Layout</option>
                        <option value="Port Connections">Port Connections</option>
                        <option value="Pole/Mount">Pole / Wall Mounting</option>
                        <option value="Maintenance">Maintenance Inspection</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                        Select File (JPG, PNG, WEBP)
                      </label>
                      <input
                        type="file"
                        accept="image/*"
                        onChange={handleFileUpload}
                        className="w-full text-xs text-slate-500 file:mr-2 file:py-1 file:px-2.5 file:rounded-md file:border-0 file:text-xs file:font-semibold file:bg-emerald-600 file:text-white hover:file:bg-emerald-500"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Active Image Canvas with Non-Destructive Annotation Overlay */}
              {currentImage ? (
                <div className="space-y-3">
                  {/* Annotation Toolbar */}
                  <div className="p-2.5 bg-slate-900 text-white rounded-xl flex items-center justify-between text-xs">
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => setIsAnnotating(!isAnnotating)}
                        className={`px-3 py-1 rounded-lg font-bold text-xs flex items-center gap-1.5 transition-all ${
                          isAnnotating
                            ? 'bg-emerald-500 text-white shadow-sm'
                            : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                        }`}
                      >
                        <Crosshair className="w-3.5 h-3.5" />
                        <span>{isAnnotating ? 'Annotation Mode ON (Click image)' : 'Enable Port Markup'}</span>
                      </button>

                      {isAnnotating && (
                        <div className="flex items-center gap-2 border-l border-slate-700 pl-3">
                          <span className="text-[11px] text-slate-400">Status:</span>
                          {(['Available', 'Occupied', 'Reserved', 'Faulty'] as const).map((st) => (
                            <button
                              key={st}
                              type="button"
                              onClick={() => setNewAnnotationStatus(st)}
                              className={`px-2 py-0.5 rounded text-[10px] font-bold transition-colors ${
                                newAnnotationStatus === st
                                  ? st === 'Available'
                                    ? 'bg-emerald-500 text-white'
                                    : st === 'Occupied'
                                      ? 'bg-blue-600 text-white'
                                      : st === 'Reserved'
                                        ? 'bg-amber-500 text-white'
                                        : 'bg-rose-600 text-white'
                                  : 'bg-slate-800 text-slate-400 hover:text-white'
                              }`}
                            >
                              {st}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="text-[11px] text-slate-400">
                      Original photograph preserved &bull; {currentImage.annotations.length} markers linked
                    </div>
                  </div>

                  {/* Image Display Area with Pin Badges */}
                  <div
                    ref={imageContainerRef}
                    onClick={handleImageClick}
                    className={`relative w-full rounded-2xl overflow-hidden border border-slate-300 bg-slate-950 flex items-center justify-center max-h-[380px] ${
                      isAnnotating ? 'cursor-crosshair' : 'cursor-default'
                    }`}
                  >
                    <img
                      src={currentImage.url}
                      alt={currentImage.name}
                      className="w-full h-auto max-h-[380px] object-contain select-none"
                    />

                    {/* Render Annotations Non-Destructively */}
                    {currentImage.annotations.map((anno) => {
                      const badgeBg =
                        anno.status === 'Available'
                          ? 'bg-emerald-600'
                          : anno.status === 'Occupied'
                            ? 'bg-blue-600'
                            : anno.status === 'Reserved'
                              ? 'bg-amber-600'
                              : 'bg-rose-600';
                      return (
                        <div
                          key={anno.id}
                          style={{ left: `${anno.x}%`, top: `${anno.y}%` }}
                          className="absolute -translate-x-1/2 -translate-y-1/2 group"
                        >
                          <div
                            className={`w-6 h-6 rounded-full ${badgeBg} border-2 border-white text-white font-bold text-[10px] flex items-center justify-center shadow-lg transition-transform hover:scale-125`}
                          >
                            {anno.portNumber || '!'}
                          </div>

                          {/* Hover Tooltip Card */}
                          <div className="hidden group-hover:flex absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-48 bg-slate-900/95 backdrop-blur-md text-white p-2 rounded-lg text-[10px] shadow-xl z-30 flex-col gap-1 pointer-events-auto">
                            <div className="font-bold text-sky-400 flex justify-between items-center">
                              <span>{anno.label}</span>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  deleteImageAnnotation(targetTerminal.id, currentImage.id, anno.id);
                                }}
                                className="text-rose-400 hover:text-rose-200"
                                title="Delete marker"
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            </div>
                            <div className="text-slate-300">{anno.remarks}</div>
                            <div className="text-[9px] text-slate-400">Status: {anno.status}</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Image Metadata Bar */}
                  <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs flex items-center justify-between">
                    <div>
                      <div className="font-bold text-slate-800">{currentImage.name}</div>
                      <div className="text-[11px] text-slate-500">
                        Uploaded by <span className="font-semibold">{currentImage.uploadedBy}</span> on{' '}
                        {currentImage.uploadDate} &bull; Category: {currentImage.category}
                      </div>
                    </div>
                    <div className="text-[11px] text-slate-400 max-w-xs text-right">{currentImage.description}</div>
                  </div>
                </div>
              ) : (
                <div className="text-center py-12 text-slate-400">
                  <Camera className="w-8 h-8 mx-auto text-slate-300 mb-2" />
                  <div>No Photographs Uploaded for this Terminal Box</div>
                  <button
                    onClick={() => setIsUploadingPhoto(true)}
                    className="mt-2 px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-semibold"
                  >
                    Upload First Photo
                  </button>
                </div>
              )}
            </div>
          )}

          {/* TAB 2: PORT MANAGEMENT (SPLITTER 1:8) */}
          {activeTab === 'ports' && (
            <div className="space-y-4 text-xs">
              <div className="flex items-center justify-between p-3 bg-blue-50/70 rounded-xl border border-blue-200">
                <div>
                  <div className="font-bold text-xs text-blue-900">
                    Splitter Module: {terminalSplitter?.name || '1:8 PLC Cassette'}
                  </div>
                  <div className="text-[11px] text-blue-800">
                    Ratio: {terminalSplitter?.ratio || '1:8'} &bull; Insertion Loss:{' '}
                    {terminalSplitter?.insertionLossDb || 10.3} dB &bull; Status: Active
                  </div>
                </div>
                <span className="text-[11px] font-bold text-blue-700 bg-blue-100 px-2.5 py-1 rounded-lg">
                  Input Lead: IN-01 (Feeder Branch 01)
                </span>
              </div>

              {/* Visual Port List */}
              <div className="grid grid-cols-2 gap-3">
                {terminalSplitter?.outputPorts.map((port) => {
                  const isAvailable = port.status === 'Available';
                  const isFaulty = port.status === 'Faulty';
                  return (
                    <div
                      key={port.portNumber}
                      className={`p-3 rounded-xl border flex items-center justify-between ${
                        isAvailable
                          ? 'bg-emerald-50/40 border-emerald-200'
                          : isFaulty
                            ? 'bg-rose-50/40 border-rose-200'
                            : 'bg-slate-50 border-slate-200'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div
                          className={`w-8 h-8 rounded-lg flex items-center justify-center font-bold text-xs ${
                            isAvailable
                              ? 'bg-emerald-600 text-white'
                              : isFaulty
                                ? 'bg-rose-600 text-white'
                                : 'bg-blue-600 text-white'
                          }`}
                        >
                          {port.portNumber}
                        </div>
                        <div>
                          <div className="font-bold text-xs text-slate-800">{port.label}</div>
                          <div className="text-[11px] text-slate-500">
                            {port.connectedCustomerName || (isAvailable ? 'Free to connect' : 'Port Fault')}
                          </div>
                        </div>
                      </div>

                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          isAvailable
                            ? 'bg-emerald-100 text-emerald-800'
                            : isFaulty
                              ? 'bg-rose-100 text-rose-800'
                              : 'bg-blue-100 text-blue-800'
                        }`}
                      >
                        {port.status}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* TAB 3: OVERVIEW */}
          {activeTab === 'overview' && (
            <div className="space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-4">
                <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-2">
                  <div className="font-bold text-xs text-slate-800 border-b pb-1">Asset Identity</div>
                  <div>
                    <span className="text-slate-500">Name:</span>{' '}
                    <span className="font-semibold">{targetTerminal.name}</span>
                  </div>
                  <div>
                    <span className="text-slate-500">ID:</span>{' '}
                    <span className="font-mono font-bold text-blue-600">{targetTerminal.id}</span>
                  </div>
                  <div>
                    <span className="text-slate-500">Type:</span>{' '}
                    <span className="font-semibold">{targetTerminal.type}</span>
                  </div>
                  <div>
                    <span className="text-slate-500">Manufacturer:</span>{' '}
                    <span className="font-semibold">{targetTerminal.manufacturer || 'Huawei OptiX'}</span>
                  </div>
                  <div>
                    <span className="text-slate-500">Installation Date:</span>{' '}
                    <span className="font-semibold">{targetTerminal.installedDate}</span>
                  </div>
                </div>

                <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-2">
                  <div className="font-bold text-xs text-slate-800 border-b pb-1">Geographic Placement</div>
                  <div>
                    <span className="text-slate-500">Area:</span>{' '}
                    <span className="font-semibold">{targetTerminal.area}</span>
                  </div>
                  <div>
                    <span className="text-slate-500">Street:</span>{' '}
                    <span className="font-semibold">{targetTerminal.street}</span>
                  </div>
                  <div>
                    <span className="text-slate-500">Mounting Pole:</span>{' '}
                    <span className="font-semibold">{targetTerminal.poleNumber || 'Wall Mounted'}</span>
                  </div>
                  <div>
                    <span className="text-slate-500">GPS Coordinates:</span>{' '}
                    <span className="font-mono">
                      {targetTerminal.lat.toFixed(5)}, {targetTerminal.lng.toFixed(5)}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: MAINTENANCE LOG */}
          {activeTab === 'maintenance' && (
            <div className="space-y-3 text-xs">
              <div className="font-bold text-xs text-slate-800">Field Maintenance History</div>
              <div className="space-y-2">
                <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 flex items-center justify-between">
                  <div>
                    <div className="font-bold text-slate-800">Optical Clean & Splicer Inspection</div>
                    <div className="text-[11px] text-slate-500">Technician Arun Varma &bull; 2026-10-31 04:30 PM</div>
                    <div className="text-[11px] text-slate-600 mt-1">
                      Cleaned splitter optical ferrules, tested attenuation with optical power meter. Port 8 marked
                      faulty.
                    </div>
                  </div>
                  <span className="text-[10px] font-bold bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded">
                    Verified
                  </span>
                </div>
                <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 flex items-center justify-between">
                  <div>
                    <div className="font-bold text-slate-800">Initial Installation & Fiber Splicing</div>
                    <div className="text-[11px] text-slate-500">Technician Ramesh Gowda &bull; 2024-05-15 11:00 AM</div>
                    <div className="text-[11px] text-slate-600 mt-1">
                      Mounted FAT-01 to POLE-01, spliced 12F aerial drop cable input lead to 1:8 PLC module.
                    </div>
                  </div>
                  <span className="text-[10px] font-bold bg-slate-100 text-slate-700 px-2 py-0.5 rounded">
                    Completed
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
