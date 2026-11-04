import React, { useState } from 'react';
import { useNetwork } from '../../context/NetworkContext';
import {
  Tv,
  Radio,
  Activity,
  Layers,
  MapPin,
  GitBranch,
  ShieldCheck,
  AlertTriangle,
  Zap,
  Sliders,
  CheckCircle2,
  ExternalLink,
  Search,
  Hash,
} from 'lucide-react';

export const CableTVView: React.FC = () => {
  const { equipments, cables, customers, faults, setActiveMainView, flyToLocation, setSelectedObject, toggleLayer } =
    useNetwork();

  const [activeTab, setActiveTab] = useState<'schematic' | 'spectrum' | 'subscribers'>('schematic');
  const [selectedNode, setSelectedNode] = useState<{
    id: string;
    name: string;
    type: string;
    rfLevel: string;
    details: string;
    lat?: number;
    lng?: number;
  } | null>(null);

  // CATV infrastructure from equipments
  const catvEquipment = equipments.filter(
    (e) =>
      e.category === 'Cable TV Infrastructure' ||
      e.type.includes('CATV') ||
      e.type.includes('Headend') ||
      e.type.includes('Optical Transmitter'),
  );

  const catvCables = cables.filter((c) => c.cableCategory === 'Coaxial' || c.type === 'Coaxial Cable');
  const catvCustomers = customers.filter((c) => c.serviceType === 'Cable TV' || c.serviceType === 'Triple Play');

  const handleLocateOnMap = (lat?: number, lng?: number) => {
    if (lat && lng) {
      setActiveMainView('map');
      setTimeout(() => {
        flyToLocation(lat, lng, 18);
      }, 100);
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-slate-900 text-slate-100 overflow-hidden select-none">
      {/* Top Header */}
      <div className="h-16 bg-slate-950 border-b border-slate-800 px-6 flex items-center justify-between shrink-0 shadow-md z-10">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-orange-600/20 border border-orange-500/40 flex items-center justify-center text-orange-400">
            <Tv className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-bold text-white tracking-wide">Cable TV (CATV / HFC) Network Management</h2>
              <span className="text-[10px] font-semibold bg-orange-950/80 text-orange-400 border border-orange-800/80 px-2 py-0.5 rounded">
                HFC 862 MHz / DOCSIS 3.1
              </span>
            </div>
            <p className="text-[11px] text-slate-400">
              Hybrid Fiber-Coaxial RF distribution from Master Headend to Customer Set-Top Boxes
            </p>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="flex items-center gap-2 bg-slate-900 p-1 rounded-xl border border-slate-800 text-xs">
          <button
            onClick={() => setActiveTab('schematic')}
            className={`px-3 py-1.5 rounded-lg font-semibold transition-all ${
              activeTab === 'schematic' ? 'bg-orange-600 text-white shadow-xs' : 'text-slate-400 hover:text-white'
            }`}
          >
            HFC Distribution Schematic
          </button>
          <button
            onClick={() => setActiveTab('spectrum')}
            className={`px-3 py-1.5 rounded-lg font-semibold transition-all ${
              activeTab === 'spectrum' ? 'bg-orange-600 text-white shadow-xs' : 'text-slate-400 hover:text-white'
            }`}
          >
            RF Spectrum & Channels
          </button>
          <button
            onClick={() => setActiveTab('subscribers')}
            className={`px-3 py-1.5 rounded-lg font-semibold transition-all ${
              activeTab === 'subscribers' ? 'bg-orange-600 text-white shadow-xs' : 'text-slate-400 hover:text-white'
            }`}
          >
            STB Subscribers ({catvCustomers.length})
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex overflow-hidden">
        {activeTab === 'schematic' && (
          <div className="flex-1 flex overflow-hidden">
            {/* HFC Signal Flow Diagram */}
            <div className="flex-1 overflow-y-auto p-8 flex flex-col items-center">
              <div className="w-full max-w-4xl space-y-8 pb-16">
                {/* 1. Master Headend */}
                <div className="flex flex-col items-center">
                  <div className="px-3 py-1 bg-orange-950/80 text-orange-400 rounded-full text-[11px] font-bold uppercase tracking-wider mb-3 border border-orange-800/80 flex items-center gap-1.5">
                    <Radio className="w-3 h-3 text-orange-400" />
                    Stage 1: Master Headend & Optical Transmitters
                  </div>
                  <div
                    onClick={() =>
                      setSelectedNode({
                        id: 'HEADEND-01',
                        name: 'Central Cable TV Master Headend',
                        type: 'Headend & Optical TX',
                        rfLevel: 'RF Input: 82 dBµV | Optical Tx: +10.5 dBm @ 1550nm',
                        details: 'QAM Modulators, 250+ HD Channels, Dual EDFA +22 dBm Booster Amplifiers',
                      })
                    }
                    className="p-4 bg-slate-950 border-2 border-orange-500/40 hover:border-orange-500 rounded-2xl shadow-xl w-80 text-center cursor-pointer transition-all"
                  >
                    <div className="text-xs font-bold text-white">Central Headend & 1550nm EDFA</div>
                    <div className="text-[11px] text-slate-400 mt-1">Fiber Laser Transmitter (+10 dBm)</div>
                    <div className="mt-2 text-[10px] font-mono text-emerald-400 bg-emerald-950/60 py-1 px-2 rounded border border-emerald-800/60">
                      RF Level: 82 dBµV &bull; 1550nm Optical Output
                    </div>
                  </div>
                </div>

                {/* Downward Fiber Trunk Line */}
                <div className="flex flex-col items-center">
                  <div className="h-6 w-0.5 bg-blue-500" />
                  <span className="text-[10px] font-mono text-blue-400 bg-slate-950 px-2.5 py-0.5 rounded border border-slate-800">
                    Single-Mode Optical Fiber Feeder (Trunk)
                  </span>
                  <div className="h-6 w-0.5 bg-blue-500" />
                </div>

                {/* 2. CATV Optical Nodes */}
                <div className="flex flex-col items-center">
                  <div className="px-3 py-1 bg-slate-800 text-slate-300 rounded-full text-[11px] font-bold uppercase tracking-wider mb-3 border border-slate-700 flex items-center gap-1.5">
                    <Activity className="w-3 h-3 text-sky-400" />
                    Stage 2: CATV Optical Nodes (Photo-Receiver &rarr; RF Coaxial)
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 w-full">
                    {[
                      {
                        id: 'NODE-01',
                        name: 'Optical Node Sector 01',
                        area: 'Koramangala 4th Block',
                        rfOut: '104 dBµV',
                        opticalIn: '-1.5 dBm',
                        lat: 12.937,
                        lng: 77.628,
                      },
                      {
                        id: 'NODE-02',
                        name: 'Optical Node Sector 02',
                        area: 'Koramangala 5th Block',
                        rfOut: '102 dBµV',
                        opticalIn: '-1.8 dBm',
                        lat: 12.939,
                        lng: 77.6295,
                      },
                      {
                        id: 'NODE-03',
                        name: 'Optical Node Sector 03',
                        area: 'Indiranagar Hub',
                        rfOut: '104 dBµV',
                        opticalIn: '-1.2 dBm',
                        lat: 12.942,
                        lng: 77.625,
                      },
                    ].map((node) => (
                      <div
                        key={node.id}
                        onClick={() =>
                          setSelectedNode({
                            id: node.id,
                            name: node.name,
                            type: 'CATV Optical Node',
                            rfLevel: `Optical In: ${node.opticalIn} | RF Output: ${node.rfOut}`,
                            details: `Area: ${node.area} | Forward Path: 47-862 MHz | Reverse: 5-65 MHz`,
                            lat: node.lat,
                            lng: node.lng,
                          })
                        }
                        className="p-3.5 bg-slate-950 border border-slate-800 hover:border-sky-500 rounded-xl cursor-pointer transition-all shadow-sm"
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[10px] font-mono font-bold text-sky-400">{node.id}</span>
                          <span className="text-[10px] text-emerald-400 font-mono">{node.opticalIn}</span>
                        </div>
                        <div className="text-xs font-bold text-white">{node.name}</div>
                        <div className="text-[10px] text-slate-400">{node.area}</div>
                        <div className="mt-2 text-[10px] font-mono text-orange-400 bg-orange-950/40 p-1 rounded text-center border border-orange-900/60">
                          RF Output: {node.rfOut}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Downward Coaxial Trunk Line */}
                <div className="flex flex-col items-center">
                  <div className="h-6 w-0.5 bg-orange-500" />
                  <span className="text-[10px] font-mono text-orange-400 bg-slate-950 px-2.5 py-0.5 rounded border border-slate-800">
                    RG-11 / 0.500 Aluminum Coaxial Trunk Cable (75 &Omega;)
                  </span>
                  <div className="h-6 w-0.5 bg-orange-500" />
                </div>

                {/* 3. RF Line Amplifiers */}
                <div className="flex flex-col items-center">
                  <div className="px-3 py-1 bg-slate-800 text-slate-300 rounded-full text-[11px] font-bold uppercase tracking-wider mb-3 border border-slate-700 flex items-center gap-1.5">
                    <Zap className="w-3 h-3 text-amber-400" />
                    Stage 3: RF Trunk Amplifiers & Line Extenders
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 w-full">
                    {[
                      {
                        id: 'AMP-01',
                        name: 'Trunk Amplifier T-01',
                        gain: '+30 dB',
                        input: '68 dBµV',
                        output: '98 dBµV',
                        lat: 12.9375,
                        lng: 77.6285,
                      },
                      {
                        id: 'AMP-02',
                        name: 'Line Extender LE-02',
                        gain: '+26 dB',
                        input: '72 dBµV',
                        output: '98 dBµV',
                        lat: 12.9385,
                        lng: 77.629,
                      },
                      {
                        id: 'AMP-03',
                        name: 'Trunk Amplifier T-03',
                        gain: '+30 dB',
                        input: '70 dBµV',
                        output: '100 dBµV',
                        lat: 12.941,
                        lng: 77.626,
                      },
                    ].map((amp) => (
                      <div
                        key={amp.id}
                        onClick={() =>
                          setSelectedNode({
                            id: amp.id,
                            name: amp.name,
                            type: 'CATV RF Amplifier',
                            rfLevel: `Input: ${amp.input} | Gain: ${amp.gain} | Output: ${amp.output}`,
                            details: 'Line Extender with built-in slope & tilt equalizer (60V AC Power Injected)',
                            lat: amp.lat,
                            lng: amp.lng,
                          })
                        }
                        className="p-3 bg-slate-950 border border-slate-800 hover:border-amber-500 rounded-xl cursor-pointer transition-all shadow-sm"
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[10px] font-mono font-bold text-amber-400">{amp.id}</span>
                          <span className="text-[10px] font-mono text-slate-400">{amp.gain}</span>
                        </div>
                        <div className="text-xs font-bold text-white">{amp.name}</div>
                        <div className="mt-2 text-[10px] font-mono text-slate-300 flex justify-between bg-slate-900 p-1.5 rounded">
                          <span>In: {amp.input}</span>
                          <span className="text-amber-400 font-bold">Out: {amp.output}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Downward Tap Distribution Line */}
                <div className="flex flex-col items-center">
                  <div className="h-6 w-0.5 bg-yellow-500" />
                  <span className="text-[10px] font-mono text-yellow-400 bg-slate-950 px-2.5 py-0.5 rounded border border-slate-800">
                    Directional Couplers & 4-Way / 8-Way Tap-Offs
                  </span>
                  <div className="h-6 w-0.5 bg-yellow-500" />
                </div>

                {/* 4. Tap-Off Boxes & Subscriber Endpoints */}
                <div className="flex flex-col items-center">
                  <div className="px-3 py-1 bg-slate-800 text-slate-300 rounded-full text-[11px] font-bold uppercase tracking-wider mb-3 border border-slate-700 flex items-center gap-1.5">
                    <Tv className="w-3 h-3 text-orange-400" />
                    Stage 4: Tap-Off Ports & Customer STB Sockets (Target: 60 - 72 dBµV)
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 w-full">
                    {[
                      { port: 'Tap 1 (8-Way)', tapLoss: '17 dB', signal: '72 dBµV', stbs: 6 },
                      { port: 'Tap 2 (4-Way)', tapLoss: '14 dB', signal: '74 dBµV', stbs: 4 },
                      { port: 'Tap 3 (8-Way)', tapLoss: '20 dB', signal: '68 dBµV', stbs: 7 },
                      { port: 'Tap 4 (4-Way)', tapLoss: '11 dB', signal: '70 dBµV', stbs: 4 },
                    ].map((tap) => (
                      <div key={tap.port} className="p-3 bg-slate-950 border border-slate-800 rounded-xl text-center">
                        <div className="text-[11px] font-bold text-white">{tap.port}</div>
                        <div className="text-[10px] text-slate-400">Tap Loss: {tap.tapLoss}</div>
                        <div className="mt-1.5 text-xs font-mono font-bold text-emerald-400 bg-emerald-950/60 py-0.5 rounded border border-emerald-900/60">
                          {tap.signal}
                        </div>
                        <div className="mt-1 text-[10px] text-slate-400">{tap.stbs} Active STBs</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Right Node Inspector */}
            {selectedNode && (
              <aside className="w-80 bg-slate-950 border-l border-slate-800 p-5 flex flex-col justify-between overflow-y-auto shrink-0 shadow-2xl">
                <div>
                  <div className="flex items-center justify-between border-b border-slate-800 pb-3 mb-4">
                    <div>
                      <h3 className="font-bold text-sm text-white">{selectedNode.name}</h3>
                      <p className="text-[10px] text-orange-400 font-mono">{selectedNode.id}</p>
                    </div>
                    <button
                      onClick={() => setSelectedNode(null)}
                      className="text-slate-400 hover:text-white text-xs px-2 py-1 rounded hover:bg-slate-800"
                    >
                      &times;
                    </button>
                  </div>

                  <div className="space-y-3.5 text-xs">
                    <div>
                      <span className="text-[10px] font-bold text-slate-400 uppercase">Device Category</span>
                      <div className="text-slate-200 mt-1 font-semibold">{selectedNode.type}</div>
                    </div>

                    <div>
                      <span className="text-[10px] font-bold text-slate-400 uppercase">
                        RF Signal Level / Telemetry
                      </span>
                      <div className="mt-1 bg-slate-900 border border-slate-800 p-2.5 rounded-lg text-emerald-400 font-mono text-[11px]">
                        {selectedNode.rfLevel}
                      </div>
                    </div>

                    <div>
                      <span className="text-[10px] font-bold text-slate-400 uppercase">Technical Specifications</span>
                      <p className="mt-1 text-slate-400 bg-slate-900 p-2.5 rounded-lg border border-slate-800 text-[11px] leading-relaxed">
                        {selectedNode.details}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="border-t border-slate-800 pt-4">
                  {selectedNode.lat && selectedNode.lng && (
                    <button
                      onClick={() => handleLocateOnMap(selectedNode.lat, selectedNode.lng)}
                      className="w-full py-2.5 px-3 bg-orange-600 hover:bg-orange-500 text-white rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 shadow-md transition-all"
                    >
                      <MapPin className="w-3.5 h-3.5" />
                      <span>Locate on GIS Map</span>
                    </button>
                  )}
                </div>
              </aside>
            )}
          </div>
        )}

        {/* Tab 2: Spectrum & Channels */}
        {activeTab === 'spectrum' && (
          <div className="flex-1 overflow-auto p-6">
            <div className="max-w-4xl mx-auto space-y-6">
              <div>
                <h3 className="text-base font-bold text-white">RF Frequency Spectrum Allocation (5 - 862 MHz)</h3>
                <p className="text-xs text-slate-400">
                  Standard PAL-D/K and NTSC Frequency Plans with DOCSIS 3.1 EuroDOCSIS Plan
                </p>
              </div>

              <div className="bg-slate-950 rounded-xl border border-slate-800 overflow-hidden">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-900 border-b border-slate-800 text-slate-400 text-[11px] uppercase">
                    <tr>
                      <th className="py-2.5 px-4">Band</th>
                      <th className="py-2.5 px-4">Frequency Range</th>
                      <th className="py-2.5 px-4">Allocated Usage</th>
                      <th className="py-2.5 px-4">Modulation</th>
                      <th className="py-2.5 px-4">Target Signal</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 font-mono text-[11px]">
                    <tr>
                      <td className="py-2.5 px-4 text-orange-400 font-bold">Sub-Split Return</td>
                      <td className="py-2.5 px-4">5 - 65 MHz</td>
                      <td className="py-2.5 px-4 font-sans">DOCSIS 3.0 Upstream Data / Interactive STB Return</td>
                      <td className="py-2.5 px-4">QPSK / 16-QAM</td>
                      <td className="py-2.5 px-4 text-emerald-400">105 dBµV Tx</td>
                    </tr>
                    <tr>
                      <td className="py-2.5 px-4 text-sky-400 font-bold">VHF Low</td>
                      <td className="py-2.5 px-4">88 - 108 MHz</td>
                      <td className="py-2.5 px-4 font-sans">Broadcast FM Radio Channels</td>
                      <td className="py-2.5 px-4">Analog FM</td>
                      <td className="py-2.5 px-4 text-emerald-400">62 dBµV</td>
                    </tr>
                    <tr>
                      <td className="py-2.5 px-4 text-sky-400 font-bold">VHF High / Mid</td>
                      <td className="py-2.5 px-4">112 - 300 MHz</td>
                      <td className="py-2.5 px-4 font-sans">Digital DVB-C HD Multiplexes (Channels 01 - 24)</td>
                      <td className="py-2.5 px-4">256-QAM</td>
                      <td className="py-2.5 px-4 text-emerald-400">66 dBµV</td>
                    </tr>
                    <tr>
                      <td className="py-2.5 px-4 text-indigo-400 font-bold">UHF / Hyperband</td>
                      <td className="py-2.5 px-4">300 - 862 MHz</td>
                      <td className="py-2.5 px-4 font-sans">Digital DVB-C 4K HDR & DOCSIS 3.1 Downstream (OFDM)</td>
                      <td className="py-2.5 px-4">1024-QAM / 4096-QAM</td>
                      <td className="py-2.5 px-4 text-emerald-400">68 dBµV</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* Tab 3: CATV Subscribers */}
        {activeTab === 'subscribers' && (
          <div className="flex-1 overflow-auto p-6">
            <div className="max-w-5xl mx-auto space-y-4">
              <div className="flex justify-between items-center">
                <div>
                  <h3 className="text-base font-bold text-white">Active Set-Top Box (STB) Subscribers</h3>
                  <p className="text-xs text-slate-400">Real-time RF signal level at customer television premises</p>
                </div>
                <span className="text-xs font-semibold text-slate-400">
                  {catvCustomers.length} Cable TV Subscribers Connected
                </span>
              </div>

              <div className="bg-slate-950 rounded-xl border border-slate-800 overflow-hidden">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-900 border-b border-slate-800 text-slate-400 text-[11px] uppercase">
                    <tr>
                      <th className="py-2.5 px-4">Customer</th>
                      <th className="py-2.5 px-4">Plan / Package</th>
                      <th className="py-2.5 px-4">STB Serial Number</th>
                      <th className="py-2.5 px-4">Tap-Off Box</th>
                      <th className="py-2.5 px-4">RF Signal Level</th>
                      <th className="py-2.5 px-4">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {catvCustomers.map((cust) => (
                      <tr key={cust.id} className="hover:bg-slate-900/60">
                        <td className="py-2.5 px-4">
                          <div className="font-bold text-white">{cust.name}</div>
                          <div className="text-[10px] text-slate-400">
                            {cust.id} &bull; {cust.area}
                          </div>
                        </td>
                        <td className="py-2.5 px-4">
                          <span className="font-semibold text-orange-400">{cust.plan}</span>
                        </td>
                        <td className="py-2.5 px-4 font-mono text-slate-300">
                          {cust.ontSerialNumber.replace('ONT', 'STB')}
                        </td>
                        <td className="py-2.5 px-4 text-slate-300">{cust.terminalBoxId}</td>
                        <td className="py-2.5 px-4 font-mono text-emerald-400 font-bold">66.4 dBµV</td>
                        <td className="py-2.5 px-4">
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-950 text-emerald-400 border border-emerald-800">
                            {cust.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
