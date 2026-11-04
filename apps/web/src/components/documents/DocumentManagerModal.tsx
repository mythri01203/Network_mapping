import React, { useState } from 'react';
import { useNetwork } from '../../context/NetworkContext';
import type { NetworkDocument } from '@fibergis/shared';
import { FileText, Search, Download, Trash2, PlusCircle, FileCheck, X } from 'lucide-react';

export const DocumentManagerModal: React.FC = () => {
  const { documents, addDocument, deleteDocument, isDocumentModalOpen, setIsDocumentModalOpen, showToast } =
    useNetwork();

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [isUploadOpen, setIsUploadOpen] = useState(false);

  // Form state
  const [newTitle, setNewTitle] = useState('');
  const [newCategory, setNewCategory] = useState<NetworkDocument['category']>('Datasheet');
  const [newAssetId, setNewAssetId] = useState('');

  if (!isDocumentModalOpen) return null;

  const categories: Array<NetworkDocument['category'] | 'All'> = [
    'All',
    'Datasheet',
    'OTDR Trace',
    'Inspection Report',
    'As-Built CAD',
    'Lease Agreement',
  ];

  const filteredDocs = documents.filter((d) => {
    const matchesSearch =
      searchQuery === '' ||
      d.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (d.equipmentId && d.equipmentId.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (d.cableId && d.cableId.toLowerCase().includes(searchQuery.toLowerCase()));

    const matchesCategory = selectedCategory === 'All' || d.category === selectedCategory;

    return matchesSearch && matchesCategory;
  });

  const handleUploadSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle) {
      showToast('error', 'Missing Title', 'Please enter a document title.');
      return;
    }

    const created = addDocument({
      title: newTitle,
      category: newCategory,
      equipmentId: newAssetId.startsWith('OLT') || newAssetId.startsWith('FAT') ? newAssetId : undefined,
      cableId: newAssetId.startsWith('CBL') ? newAssetId : undefined,
    });
    if (!created) return;

    setIsUploadOpen(false);
    setNewTitle('');
    setNewAssetId('');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4 animate-in fade-in select-none">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-4xl max-h-[85vh] flex flex-col overflow-hidden">
        {/* Modal Header */}
        <div className="h-16 px-6 border-b border-slate-200 flex items-center justify-between shrink-0 bg-slate-50/50">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-600">
              <FileText className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-800">Network Technical Documentation & Datasheets</h3>
              <p className="text-[11px] text-slate-500">
                Repository for OTDR traces, equipment datasheets, as-built CADs, and lease deeds
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsUploadOpen(!isUploadOpen)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-semibold shadow-2xs transition-colors"
            >
              <PlusCircle className="w-3.5 h-3.5" />
              <span>Upload Document</span>
            </button>
            <button
              onClick={() => setIsDocumentModalOpen(false)}
              className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Upload Form Accordion */}
        {isUploadOpen && (
          <form
            onSubmit={handleUploadSubmit}
            className="p-4 bg-blue-50/50 border-b border-blue-100 space-y-3 text-xs animate-in slide-in-from-top-2"
          >
            <div className="font-bold text-xs text-blue-900">Upload New Technical Document</div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-[10px] font-bold text-slate-600 mb-1">Document Title</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. OTDR Trace Feeder Cable 01 - 1310nm"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-600 mb-1">Category</label>
                <select
                  value={newCategory}
                  onChange={(e) => setNewCategory(e.target.value as any)}
                  className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs outline-none focus:border-blue-500"
                >
                  <option value="Datasheet">Datasheet</option>
                  <option value="OTDR Trace">OTDR Trace Report</option>
                  <option value="Inspection Report">Field Inspection Report</option>
                  <option value="As-Built CAD">As-Built CAD Drawing</option>
                  <option value="Lease Agreement">Right-of-Way Lease Deed</option>
                </select>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-600 mb-1">Linked Asset ID (Optional)</label>
                <input
                  type="text"
                  placeholder="e.g. CBL-FEEDER-01 or OLT-01"
                  value={newAssetId}
                  onChange={(e) => setNewAssetId(e.target.value)}
                  className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs outline-none focus:border-blue-500"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setIsUploadOpen(false)}
                className="px-3 py-1 text-slate-600 hover:bg-slate-200/50 rounded-lg font-semibold"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-semibold shadow-2xs"
              >
                Upload File
              </button>
            </div>
          </form>
        )}

        {/* Search & Category Filter Toolbar */}
        <div className="p-4 border-b border-slate-200 bg-white flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-3 flex-1 max-w-md">
            <div className="relative flex-1">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search documents by title or asset ID..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 bg-slate-100 hover:bg-slate-200/80 focus:bg-white border border-slate-200 focus:border-blue-500 rounded-lg text-xs outline-none transition-all"
              />
            </div>

            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="px-3 py-1.5 bg-slate-100 border border-slate-200 rounded-lg text-xs font-medium text-slate-700 outline-none"
            >
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c === 'All' ? 'All Categories' : c}
                </option>
              ))}
            </select>
          </div>

          <span className="text-xs text-slate-400 font-medium">{filteredDocs.length} Documents Available</span>
        </div>

        {/* Documents Table */}
        <div className="flex-1 overflow-auto p-4">
          <div className="bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 text-[11px] uppercase font-bold">
                <tr>
                  <th className="py-2.5 px-4">Title</th>
                  <th className="py-2.5 px-4">Category</th>
                  <th className="py-2.5 px-4">Linked Asset</th>
                  <th className="py-2.5 px-4">Uploaded By</th>
                  <th className="py-2.5 px-4">Upload Date</th>
                  <th className="py-2.5 px-4">Size</th>
                  <th className="py-2.5 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredDocs.map((doc) => (
                  <tr key={doc.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="py-3 px-4 font-bold text-slate-800 flex items-center gap-2">
                      <FileCheck className="w-4 h-4 text-blue-600 shrink-0" />
                      <span className="truncate max-w-xs">{doc.title}</span>
                    </td>
                    <td className="py-3 px-4">
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-700 border border-slate-200">
                        {doc.category}
                      </span>
                    </td>
                    <td className="py-3 px-4 font-mono text-[11px] text-blue-600 font-semibold">
                      {doc.equipmentId || doc.cableId || <span className="text-slate-400 font-normal">Global</span>}
                    </td>
                    <td className="py-3 px-4 text-slate-600">{doc.uploadedBy}</td>
                    <td className="py-3 px-4 font-mono text-slate-400 text-[11px]">{doc.uploadDate}</td>
                    <td className="py-3 px-4 font-mono text-slate-400 text-[11px]">{doc.fileSizeKb} KB</td>
                    <td className="py-3 px-4 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          onClick={() => showToast('info', 'Download Started', `Downloading ${doc.title}...`)}
                          className="p-1.5 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                          title="Download File"
                        >
                          <Download className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => deleteDocument(doc.id)}
                          className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                          title="Delete Document"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};
