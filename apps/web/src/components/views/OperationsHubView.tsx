import React, { useState } from 'react';
import { useNetwork } from '../../context/NetworkContext';
import { type WorkOrder } from '../../types/network';
import { Kanban, List, PlusCircle, Search, HardHat } from 'lucide-react';

export const OperationsHubView: React.FC = () => {
  const { workOrders, updateWorkOrderStatus, addWorkOrder, showToast } = useNetwork();

  const [viewMode, setViewMode] = useState<'kanban' | 'list'>('kanban');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedPriority, setSelectedPriority] = useState<string>('All');
  const [isNewOrderModalOpen, setIsNewOrderModalOpen] = useState(false);

  // New Work Order form state
  const [newTitle, setNewTitle] = useState('');
  const [newType, setNewType] = useState<WorkOrder['type']>('Repair');
  const [newPriority, setNewPriority] = useState<WorkOrder['priority']>('High');
  const [newTechName, setNewTechName] = useState('Arun Varma (Lead Splicer)');
  const newTechPhone = '+91 98450 11223';
  const [newNotes, setNewNotes] = useState('');

  // Filtered orders
  const filteredOrders = workOrders.filter((w) => {
    const matchesSearch =
      searchQuery === '' ||
      w.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
      w.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      w.technicianName.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesPriority = selectedPriority === 'All' || w.priority === selectedPriority;

    return matchesSearch && matchesPriority;
  });

  const columns: Array<{ status: WorkOrder['status']; label: string; color: string; count: number }> = [
    {
      status: 'Pending',
      label: 'Pending Dispatch',
      color: 'border-amber-400 bg-amber-50/40',
      count: workOrders.filter((w) => w.status === 'Pending').length,
    },
    {
      status: 'Assigned',
      label: 'Assigned to Tech',
      color: 'border-blue-400 bg-blue-50/40',
      count: workOrders.filter((w) => w.status === 'Assigned').length,
    },
    {
      status: 'In Progress',
      label: 'Work In Progress',
      color: 'border-purple-400 bg-purple-50/40',
      count: workOrders.filter((w) => w.status === 'In Progress').length,
    },
    {
      status: 'Completed',
      label: 'Resolved / Closed',
      color: 'border-emerald-400 bg-emerald-50/40',
      count: workOrders.filter((w) => w.status === 'Completed').length,
    },
  ];

  const handleCreateOrder = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) {
      showToast('error', 'Missing Title', 'Please enter a work order title.');
      return;
    }

    addWorkOrder({
      title: newTitle.trim(),
      type: newType,
      priority: newPriority,
      status: newTechName.trim() ? 'Assigned' : 'Pending',
      technicianName: newTechName.trim(),
      technicianPhone: newTechPhone.trim(),
      notes: newNotes.trim(),
    });
    setIsNewOrderModalOpen(false);
    setNewTitle('');
    setNewNotes('');
  };

  const getPriorityBadge = (priority: WorkOrder['priority']) => {
    switch (priority) {
      case 'Critical':
        return 'bg-rose-100 text-rose-800 border-rose-200';
      case 'High':
        return 'bg-amber-100 text-amber-800 border-amber-200';
      case 'Medium':
        return 'bg-blue-100 text-blue-800 border-blue-200';
      default:
        return 'bg-slate-100 text-slate-800 border-slate-200';
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-slate-50 overflow-hidden select-none">
      {/* Top Header */}
      <div className="h-16 bg-white border-b border-slate-200 px-6 flex items-center justify-between shrink-0 shadow-xs z-10">
        <div>
          <h2 className="text-base font-bold text-slate-800">Operations & Field Maintenance Hub</h2>
          <p className="text-xs text-slate-500">
            Dispatch field technicians, manage splice verifications, and track outage resolution
          </p>
        </div>

        <div className="flex items-center gap-3">
          {/* View Mode Toggle */}
          <div className="flex items-center bg-slate-100 p-0.5 rounded-lg border border-slate-200 text-xs">
            <button
              onClick={() => setViewMode('kanban')}
              className={`px-2.5 py-1 rounded-md font-semibold flex items-center gap-1 transition-all ${
                viewMode === 'kanban' ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-500 hover:text-slate-900'
              }`}
            >
              <Kanban className="w-3.5 h-3.5" />
              <span>Kanban</span>
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={`px-2.5 py-1 rounded-md font-semibold flex items-center gap-1 transition-all ${
                viewMode === 'list' ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-500 hover:text-slate-900'
              }`}
            >
              <List className="w-3.5 h-3.5" />
              <span>List View</span>
            </button>
          </div>

          <button
            onClick={() => setIsNewOrderModalOpen(true)}
            className="flex items-center gap-1.5 px-3.5 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-semibold shadow-sm transition-colors"
          >
            <PlusCircle className="w-4 h-4" />
            <span>Create Work Order</span>
          </button>
        </div>
      </div>

      {/* KPI Stats Ribbon */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 p-4 bg-slate-100/70 border-b border-slate-200/80 shrink-0">
        <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-2xs">
          <div className="text-[11px] font-bold text-slate-400 uppercase">Total Field Orders</div>
          <div className="text-xl font-extrabold text-slate-900 mt-0.5">{workOrders.length}</div>
        </div>
        <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-2xs">
          <div className="text-[11px] font-bold text-amber-600 uppercase">Pending Dispatch</div>
          <div className="text-xl font-extrabold text-amber-700 mt-0.5">
            {workOrders.filter((w) => w.status === 'Pending').length}
          </div>
        </div>
        <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-2xs">
          <div className="text-[11px] font-bold text-purple-600 uppercase">In Progress</div>
          <div className="text-xl font-extrabold text-purple-700 mt-0.5">
            {workOrders.filter((w) => w.status === 'In Progress' || w.status === 'Assigned').length}
          </div>
        </div>
        <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-2xs">
          <div className="text-[11px] font-bold text-emerald-600 uppercase">Resolved This Month</div>
          <div className="text-xl font-extrabold text-emerald-700 mt-0.5">
            {workOrders.filter((w) => w.status === 'Completed').length}
          </div>
        </div>
      </div>

      {/* Search and Filter */}
      <div className="p-3 bg-white border-b border-slate-200 flex items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-3 flex-1 max-w-md">
          <div className="relative flex-1">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Filter work orders by title or technician..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 bg-slate-100 hover:bg-slate-200/80 focus:bg-white border border-slate-200 focus:border-blue-500 rounded-lg text-xs outline-none transition-all"
            />
          </div>

          <select
            value={selectedPriority}
            onChange={(e) => setSelectedPriority(e.target.value)}
            className="px-3 py-1.5 bg-slate-100 border border-slate-200 rounded-lg text-xs font-medium text-slate-700 outline-none"
          >
            <option value="All">All Priorities</option>
            <option value="Critical">Critical</option>
            <option value="High">High</option>
            <option value="Medium">Medium</option>
            <option value="Low">Low</option>
          </select>
        </div>
      </div>

      {/* Main Workspace (Kanban or List) */}
      <div className="flex-1 overflow-auto p-4">
        {viewMode === 'kanban' ? (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 h-full">
            {columns.map((col) => {
              const ordersInCol = filteredOrders.filter((w) => w.status === col.status);

              return (
                <div
                  key={col.status}
                  className="bg-slate-100/80 rounded-2xl p-3 border border-slate-200/90 flex flex-col h-full overflow-hidden"
                >
                  {/* Column Header */}
                  <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-200">
                    <span className="text-xs font-bold text-slate-700">{col.label}</span>
                    <span className="text-[10px] font-extrabold bg-white text-slate-600 px-2 py-0.5 rounded-full border border-slate-200">
                      {ordersInCol.length}
                    </span>
                  </div>

                  {/* Cards List */}
                  <div className="flex-1 overflow-y-auto space-y-2.5 pr-1">
                    {ordersInCol.map((order) => (
                      <div
                        key={order.id}
                        className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-2xs hover:shadow-sm transition-all"
                      >
                        <div className="flex items-center justify-between mb-2">
                          <span
                            className={`text-[10px] font-bold px-2 py-0.5 rounded border ${getPriorityBadge(order.priority)}`}
                          >
                            {order.priority}
                          </span>
                          <span className="font-mono text-[10px] text-slate-400">{order.id}</span>
                        </div>

                        <h4 className="text-xs font-bold text-slate-800 leading-snug">{order.title}</h4>
                        <p className="text-[11px] text-slate-500 mt-1 line-clamp-2">{order.notes}</p>

                        <div className="mt-3 pt-2.5 border-t border-slate-100 flex items-center justify-between text-[11px]">
                          <div className="flex items-center gap-1.5 text-slate-600 font-medium">
                            <HardHat className="w-3.5 h-3.5 text-blue-600" />
                            <span className="truncate max-w-[120px]">{order.technicianName.split(' ')[0]}</span>
                          </div>
                          <span className="text-[10px] text-slate-400 font-mono">{order.scheduledDate}</span>
                        </div>

                        {/* Status Mover Buttons */}
                        <div className="mt-3 pt-2 border-t border-slate-100 flex items-center justify-between gap-1">
                          {col.status !== 'Pending' && (
                            <button
                              onClick={() => {
                                const prev =
                                  col.status === 'Completed'
                                    ? 'In Progress'
                                    : col.status === 'In Progress'
                                      ? 'Assigned'
                                      : 'Pending';
                                updateWorkOrderStatus(order.id, prev);
                              }}
                              className="text-[10px] text-slate-500 hover:text-slate-800 px-2 py-1 rounded hover:bg-slate-100"
                            >
                              &larr; Back
                            </button>
                          )}
                          {col.status !== 'Completed' && (
                            <button
                              onClick={() => {
                                const next =
                                  col.status === 'Pending'
                                    ? 'Assigned'
                                    : col.status === 'Assigned'
                                      ? 'In Progress'
                                      : 'Completed';
                                updateWorkOrderStatus(order.id, next);
                              }}
                              className="text-[10px] font-semibold text-blue-600 hover:text-blue-700 px-2 py-1 rounded hover:bg-blue-50 ml-auto flex items-center gap-1"
                            >
                              <span>Next</span> &rarr;
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 uppercase text-[11px]">
                <tr>
                  <th className="py-3 px-4">Order ID & Title</th>
                  <th className="py-3 px-4">Type</th>
                  <th className="py-3 px-4">Priority</th>
                  <th className="py-3 px-4">Assigned Technician</th>
                  <th className="py-3 px-4">Scheduled Date</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredOrders.map((order) => (
                  <tr key={order.id} className="hover:bg-slate-50">
                    <td className="py-3 px-4">
                      <div className="font-bold text-slate-900">{order.title}</div>
                      <div className="text-[10px] font-mono text-slate-400">{order.id}</div>
                    </td>
                    <td className="py-3 px-4 font-semibold text-slate-700">{order.type}</td>
                    <td className="py-3 px-4">
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded border ${getPriorityBadge(order.priority)}`}
                      >
                        {order.priority}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <div className="font-semibold text-slate-800">{order.technicianName}</div>
                      <div className="text-[10px] text-slate-400">{order.technicianPhone}</div>
                    </td>
                    <td className="py-3 px-4 font-mono text-slate-500">{order.scheduledDate}</td>
                    <td className="py-3 px-4">
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200">
                        {order.status}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right">
                      {order.status !== 'Completed' ? (
                        <button
                          onClick={() => updateWorkOrderStatus(order.id, 'Completed')}
                          className="px-2.5 py-1 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 rounded-md font-semibold text-[11px] transition-colors"
                        >
                          Mark Done
                        </button>
                      ) : (
                        <span className="text-emerald-600 font-semibold text-[11px]">Completed</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* New Work Order Modal */}
      {isNewOrderModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4 animate-in fade-in">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-md p-6">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-4">
              <h3 className="font-bold text-sm text-slate-800">Dispatch Field Work Order</h3>
              <button
                onClick={() => setIsNewOrderModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 text-xs px-2 py-1 rounded"
              >
                &times;
              </button>
            </div>

            <form onSubmit={handleCreateOrder} className="space-y-3.5 text-xs">
              <div>
                <label className="block text-[11px] font-bold text-slate-600 mb-1">Work Order Title</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Splicing inspection at Joint Closure JC-02"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs outline-none focus:border-blue-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 mb-1">Order Type</label>
                  <select
                    value={newType}
                    onChange={(e) => setNewType(e.target.value as any)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs outline-none focus:border-blue-500"
                  >
                    <option value="Repair">Emergency Repair</option>
                    <option value="Installation">Customer Installation</option>
                    <option value="Inspection">Route Inspection</option>
                    <option value="Maintenance">Scheduled Maintenance</option>
                    <option value="Splice Verification">Splice Verification</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 mb-1">Priority</label>
                  <select
                    value={newPriority}
                    onChange={(e) => setNewPriority(e.target.value as any)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs outline-none focus:border-blue-500"
                  >
                    <option value="Critical">Critical (Outage)</option>
                    <option value="High">High</option>
                    <option value="Medium">Medium</option>
                    <option value="Low">Low</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-600 mb-1">Assigned Splicer / Technician</label>
                <input
                  type="text"
                  required
                  value={newTechName}
                  onChange={(e) => setNewTechName(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-600 mb-1">Field Instructions / Notes</label>
                <textarea
                  rows={3}
                  placeholder="Specific OTDR distance or pole location instructions..."
                  value={newNotes}
                  onChange={(e) => setNewNotes(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs outline-none focus:border-blue-500 resize-none"
                />
              </div>

              <div className="border-t border-slate-100 pt-3 mt-4 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsNewOrderModalOpen(false)}
                  className="px-3 py-1.5 text-slate-600 hover:bg-slate-100 rounded-lg font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-semibold shadow-xs"
                >
                  Dispatch Order
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
