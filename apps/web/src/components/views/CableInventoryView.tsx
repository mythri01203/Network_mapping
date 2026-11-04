import React, { useState } from 'react';
import { useNetwork } from '../../context/NetworkContext';
import { getFiberColor } from '@fibergis/shared';

export const CableInventoryView: React.FC = () => {
  const { cables, setSelectedObject, setActiveMainView, flyToLocation, setIsCableWizardOpen, setIsBottomPanelOpen } =
    useNetwork();
  const [q, setQ] = useState('');
  const rows = cables.filter(
    (c) => c.id.toLowerCase().includes(q.toLowerCase()) || c.name.toLowerCase().includes(q.toLowerCase()),
  );

  return (
    <div className="flex-1 overflow-y-auto bg-slate-50 p-6">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-lg font-bold text-slate-900">Cables</h1>
            <p className="text-xs text-slate-500">
              Physical cable inventory with TIA-598 core colours (number + name, not colour alone).
            </p>
          </div>
          <button
            onClick={() => {
              setActiveMainView('map');
              setIsCableWizardOpen(true);
            }}
            className="px-3 py-2 bg-blue-600 text-white rounded-xl text-xs font-bold"
          >
            Draw cable
          </button>
        </div>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search cable ID or name"
          className="mb-3 w-full max-w-sm px-3 py-2 border rounded-xl text-sm"
        />
        <div className="bg-white border rounded-2xl overflow-hidden">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-100 text-slate-600">
              <tr>
                <th className="px-3 py-2">ID</th>
                <th className="px-3 py-2">Name</th>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2">Cores</th>
                <th className="px-3 py-2">Used / Avail</th>
                <th className="px-3 py-2">Length</th>
                <th className="px-3 py-2">Colour sample</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => {
                const used = c.cores.filter((x) => x.status === 'In Use').length;
                const avail = c.cores.filter((x) => x.status === 'Available').length;
                return (
                  <tr
                    key={c.id}
                    className="border-t hover:bg-slate-50 cursor-pointer"
                    onClick={() => {
                      setSelectedObject({ type: 'cable', data: c });
                      setActiveMainView('map');
                      setIsBottomPanelOpen(true);
                      if (c.coordinates[0]) flyToLocation(c.coordinates[0][0], c.coordinates[0][1], 16);
                    }}
                  >
                    <td className="px-3 py-2 font-mono text-blue-700">{c.id}</td>
                    <td className="px-3 py-2">{c.name}</td>
                    <td className="px-3 py-2">{c.type}</td>
                    <td className="px-3 py-2">{c.fiberCount}</td>
                    <td className="px-3 py-2">
                      {used} / {avail}
                    </td>
                    <td className="px-3 py-2">{c.lengthMeters} m</td>
                    <td className="px-3 py-2">
                      <div className="flex gap-0.5">
                        {Array.from({ length: Math.min(12, c.fiberCount) }, (_, i) => {
                          const col = getFiberColor(i + 1);
                          return (
                            <span
                              key={i}
                              title={`Core ${i + 1} ${col.name}`}
                              className="w-3 h-3 rounded-sm border"
                              style={{ background: col.hex }}
                            />
                          );
                        })}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
