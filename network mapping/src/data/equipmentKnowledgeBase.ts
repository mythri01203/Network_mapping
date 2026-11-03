export interface TechnicalSpecItem {
  label: string;
  value: string;
  description?: string;
}

export interface RelatedEquipmentRef {
  id: string;
  name: string;
  relationship: string;
}

export interface EquipmentKnowledgeItem {
  id: string;
  slug: string;
  name: string;
  fullForm: string;
  category: 'Central Office' | 'Fiber Distribution' | 'Supporting Infrastructure' | 'Customer Equipment' | 'Cable TV' | 'Comparison Guide';
  ftthStep: number; // 1 to 9
  ftthStepName: string;
  badge: string;
  searchKeywords: string[];

  // Beginner friendly overview
  beginnerSummary: string;
  whatItIs: string;
  whatItIsUsedFor: string[];
  whereInstalled: string;

  // Technical deep dive for engineers
  engineerSummary: string;
  howItWorks: string;
  howItConnects: {
    inputs: string[];
    outputs: string[];
  };

  // Hardware models & specs
  commonModels: string[];
  portSpecifications: {
    totalTypicalPorts: string;
    connectorTypes: string;
    protocolStandards: string;
    wavelengths: string;
  };
  technicalSpecs: TechnicalSpecItem[];

  // Real world deployment
  ftthPositionDescription: string;
  practicalInstallationTips: string[];
  relatedEquipment: RelatedEquipmentRef[];

  // Frequently asked questions
  faq: Array<{ question: string; answer: string }>;
}

export const EQUIPMENT_KNOWLEDGE_BASE: EquipmentKnowledgeItem[] = [
  // 1. OLT (Optical Line Terminal)
  {
    id: 'olt',
    slug: 'optical-line-terminal',
    name: 'OLT (Optical Line Terminal)',
    fullForm: 'Optical Line Terminal',
    category: 'Central Office',
    ftthStep: 1,
    ftthStepName: 'Step 1: Central Office / Headend',
    badge: 'Core Active Equipment',
    searchKeywords: ['olt', 'optical line terminal', 'central office', 'pon chassis', 'what is an olt', 'gpon olt', 'epon olt'],
    beginnerSummary: 'The OLT is the main internet powerhouse located at the telecom headquarters (Central Office). It receives high-speed internet from core routers and broadcasts it through optical laser light into fiber cables that reach thousands of homes.',
    whatItIs: 'The Optical Line Terminal (OLT) is the master active aggregation device at the service provider’s central exchange. It coordinates all downstream transmissions and upstream bandwidth grants for every customer terminal (ONT/ONU) connected to the passive optical network.',
    whatItIsUsedFor: [
      'Originating high-powered laser beams that travel through passive splitters to customer homes.',
      'Allocating upload and download bandwidth using Dynamic Bandwidth Allocation (DBA).',
      'Encrypting subscriber traffic (AES-128 downstream) to keep customer data private.',
      'Supporting thousands of residential and commercial subscribers from a single 19-inch rack unit.'
    ],
    whereInstalled: 'Mounted in standard 19-inch or 21-inch ETSI telecom racks inside temperature-controlled Central Offices (CO), Points of Presence (PoP), or outdoor hardened shelter cabinets.',
    engineerSummary: 'The OLT terminates the PON protocol (ITU-T G.984 GPON or IEEE 802.3ah EPON) and bridges Gigabit/10G Ethernet uplinks to Point-to-Multipoint (P2MP) passive optical distribution networks. It utilizes Time Division Multiplexing (TDM) downstream at 1490 nm and Time Division Multiple Access (TDMA) upstream at 1310 nm.',
    howItWorks: 'The OLT converts electrical Ethernet frames from the core IP network into optical laser pulses. Downstream data is broadcast continuously across all splitters; each ONT decrypts only its assigned packets. Upstream, the OLT assigns millisecond-precise transmission time slots to each ONT to prevent optical packet collisions on shared fiber cores.',
    howItConnects: {
      inputs: ['10G / 40G / 100G Ethernet uplinks from Core Routers / BNGs', '-48V DC redundant power supplies'],
      outputs: ['PON SFP/SFP+ optical transceivers connecting directly to the Optical Distribution Frame (ODF) via SC/UPC or SC/APC patch cords']
    },
    commonModels: [
      'Huawei SmartAX MA5800-X7 / MA5800-X15',
      'ZTE ZXA10 C300 / C320',
      'Nokia 7360 ISAM FX-4 / FX-8',
      'Fiberhome AN5516-04 / AN5516-01',
      'VSOL V1600G1 / V1600D4 (Compact 1U Pizza-Box)'
    ],
    portSpecifications: {
      totalTypicalPorts: '4 to 16 PON ports per blade (chassis accommodates 64 to 256 PON ports)',
      connectorTypes: 'SC/UPC (Blue) or SC/APC (Green) with SFP/SFP+ transceiver cages',
      protocolStandards: 'ITU-T G.984 (GPON), IEEE 802.3ah (EPON), ITU-T G.9807.1 (XGS-PON)',
      wavelengths: '1490 nm Downstream (Voice/Data), 1310 nm Upstream, 1550 nm RF Video Overlay'
    },
    technicalSpecs: [
      { label: 'Downstream Data Rate', value: '2.488 Gbps (GPON) / 1.25 Gbps (EPON) / 9.953 Gbps (XGS-PON)' },
      { label: 'Upstream Data Rate', value: '1.244 Gbps (GPON) / 1.25 Gbps (EPON) / 9.953 Gbps (XGS-PON)' },
      { label: 'Transceiver Optical Power', value: '+3.0 to +7.0 dBm (Class C+ Transceiver)' },
      { label: 'Receiver Sensitivity', value: '-32.0 dBm (Class C+ minimum)' },
      { label: 'Max Optical Split Ratio', value: '1:64 or 1:128 per PON port' },
      { label: 'Max Transmission Distance', value: '20 km (up to 40 km with extended optics)' }
    ],
    ftthPositionDescription: 'Positioned at the beginning (Step 1) of the FTTH network chain. Connects to ODF patch panels before feeding the main trunk feeder cables.',
    practicalInstallationTips: [
      'Ensure -48V DC battery backup (UPS) with at least 4 hours run time.',
      'Always clean SFP ferrule end faces with an optical click-cleaner before inserting patch cords.',
      'Maintain ambient temperature between 18°C and 25°C with adequate ventilation fan clearances.',
      'Label every PON port cable with the corresponding ODF tray and street feeder cable ID.'
    ],
    relatedEquipment: [
      { id: 'odf', name: 'ODF (Optical Distribution Frame)', relationship: 'Next downstream element; receives patch cords from OLT PON ports' },
      { id: 'feeder-cable', name: 'Main Feeder Cable', relationship: 'Trunk cable carrying combined signals out of the central office' },
      { id: 'gpon-vs-epon', name: 'GPON vs EPON Guide', relationship: 'Comparison between the two major PON standards supported by OLTs' },
      { id: 'ont', name: 'ONT (Customer Terminal)', relationship: 'Remote subscriber endpoint controlled by this OLT' }
    ],
    faq: [
      { question: 'What is the main function of an OLT?', answer: 'The OLT converts core internet data into laser light, manages bandwidth allocation, and coordinates communication with hundreds of customer ONTs over passive fiber.' },
      { question: 'How many customers can one OLT PON port handle?', answer: 'A standard GPON port supports up to 64 or 128 subscribers depending on split ratio, typically serving 32 to 64 active homes in ISP deployments.' }
    ]
  },

  // 2. GPON OLT
  {
    id: 'gpon-olt',
    slug: 'gpon-olt-itu-t',
    name: 'GPON OLT (Gigabit Passive Optical Network)',
    fullForm: 'Gigabit Passive Optical Network Optical Line Terminal',
    category: 'Central Office',
    ftthStep: 1,
    ftthStepName: 'Step 1: Central Office / Headend',
    badge: 'ITU-T G.984 Standard',
    searchKeywords: ['gpon', 'gpon olt', 'what is a gpon olt', 'itu-t g.984', '2.5g pon'],
    beginnerSummary: 'A GPON OLT is the worldwide telecommunications standard for fiber internet. It delivers asymmetrical speeds of 2.5 Gbps download and 1.25 Gbps upload, which is ideal for residential streaming, gaming, and surfing.',
    whatItIs: 'A GPON OLT implements the ITU-T G.984 telecommunications standard. It uses ATM-like GEM (GPON Encapsulation Method) framing to package variable-length Ethernet and TDM packets with 93% transmission efficiency.',
    whatItIsUsedFor: [
      'Delivering up to 2.488 Gbps downstream bandwidth per PON port.',
      'Splitting a single fiber line across up to 128 customer homes.',
      'High-efficiency encapsulation of internet traffic, VoIP voice, and IPTV video streams.'
    ],
    whereInstalled: 'Central Office 19" rack mount bays.',
    engineerSummary: 'GPON utilizes GEM framing for protocol transport, supporting fixed-frame 125-microsecond cycles. Forward Error Correction (FEC) is applied downstream and upstream to boost optical link budget by 3 dB.',
    howItWorks: 'Downstream optical pulses operate at 1490 nm using NRZ modulation. Upstream bursts operate at 1310 nm coordinated by the OLT physical-layer OAM (PLOAM) scheduler.',
    howItConnects: {
      inputs: ['10GbE SFP+ Uplink ports', '-48V DC power terminal'],
      outputs: ['GPON SFP (Class B+ or Class C+) ports to ODF']
    },
    commonModels: ['Huawei MA5800 GPBD / GPUF blades', 'ZTE GTGH / GTGO 16-Port GPON cards', 'VSOL V1600G2'],
    portSpecifications: {
      totalTypicalPorts: '8 or 16 ports per blade',
      connectorTypes: 'SC/UPC',
      protocolStandards: 'ITU-T G.984.1 / G.984.2 / G.984.3 / G.984.4',
      wavelengths: '1490 nm Down / 1310 nm Up'
    },
    technicalSpecs: [
      { label: 'Downstream Rate', value: '2.488 Gbps' },
      { label: 'Upstream Rate', value: '1.244 Gbps' },
      { label: 'Optical Budget', value: 'Class B+ (28 dB) / Class C+ (32 dB)' },
      { label: 'Max Split', value: '1:128 (Typically deployed at 1:64)' },
      { label: 'GEM Efficiency', value: '~93% payload utilization' }
    ],
    ftthPositionDescription: 'Central office headend termination.',
    practicalInstallationTips: ['Verify optical return loss >= 32 dB on all trunk connections.'],
    relatedEquipment: [
      { id: 'olt', name: 'General OLT Chassis', relationship: 'Chassis housing the GPON line cards' },
      { id: 'gpon-vs-epon', name: 'GPON vs EPON Comparison', relationship: 'Detailed differences between GPON and EPON' },
      { id: 'ont', name: 'GPON ONT', relationship: 'Customer premises unit designed for ITU-T GPON' }
    ],
    faq: [{ question: 'What is the downstream speed of GPON?', answer: 'GPON provides 2.488 Gbps shared downstream bandwidth across all subscribers on that PON port.' }]
  },

  // 3. EPON OLT
  {
    id: 'epon-olt',
    slug: 'epon-olt-ieee',
    name: 'EPON OLT (Ethernet Passive Optical Network)',
    fullForm: 'Ethernet Passive Optical Network Optical Line Terminal',
    category: 'Central Office',
    ftthStep: 1,
    ftthStepName: 'Step 1: Central Office / Headend',
    badge: 'IEEE 802.3ah Standard',
    searchKeywords: ['epon', 'epon olt', 'what is an epon olt', 'gepon', 'ieee 802.3ah'],
    beginnerSummary: 'An EPON OLT is an Ethernet-native fiber system widely popular in Asia and local cable TV operator networks. It delivers symmetric 1.25 Gbps download and 1.25 Gbps upload with simple, cost-effective equipment.',
    whatItIs: 'An EPON (Ethernet PON) OLT implements the IEEE 802.3ah standard (often called GEPON). It transmits native standard 802.3 Ethernet frames directly over optical fiber without complex encapsulation protocols.',
    whatItIsUsedFor: [
      'Cost-effective fiber broadband deployment for regional ISPs and cable TV operators.',
      'Symmetric 1.25 Gbps upload and download speeds.',
      'Direct compatibility with native Ethernet switches and VLAN tags.'
    ],
    whereInstalled: 'Central office racks or compact street sub-stations.',
    engineerSummary: 'EPON uses Multi-Point Control Protocol (MPCP) with GATE and REPORT messages for dynamic bandwidth allocation. It employs 8b/10b line coding with an effective throughput of 1.0 Gbps after overhead.',
    howItWorks: 'Transmits native variable-length Ethernet frames (64 to 1518 bytes) encapsulated in standard preamble bytes. Upstream bandwidth is scheduled via MPCP GATE messages.',
    howItConnects: {
      inputs: ['1GbE / 10GbE SFP+ uplinks', 'Dual AC/DC power supplies'],
      outputs: ['EPON SFP PX20+ transceivers connecting to ODF']
    },
    commonModels: ['VSOL V1600D8', 'BDCOM P3608 / P3616', 'ZTE C320 EPON Card ETGO'],
    portSpecifications: {
      totalTypicalPorts: '4, 8, or 16 EPON ports',
      connectorTypes: 'SC/UPC',
      protocolStandards: 'IEEE 802.3ah / CTC 3.0 (China Telecom Spec)',
      wavelengths: '1490 nm Down / 1310 nm Up'
    },
    technicalSpecs: [
      { label: 'Downstream Rate', value: '1.25 Gbps (1.0 Gbps usable)' },
      { label: 'Upstream Rate', value: '1.25 Gbps (1.0 Gbps usable)' },
      { label: 'Transceiver Class', value: 'PX20+ (24 dB budget) / PX20+++ (30 dB budget)' },
      { label: 'Max Split Ratio', value: '1:32 or 1:64' },
      { label: 'Max Distance', value: '20 km' }
    ],
    ftthPositionDescription: 'Central Office / Substation aggregation.',
    practicalInstallationTips: ['Ensure EPON ONTs match the CTC (China Telecom) profile required by the OLT firmware for auto-provisioning.'],
    relatedEquipment: [
      { id: 'gpon-vs-epon', name: 'Difference between GPON and EPON', relationship: 'Standards comparison guide' },
      { id: 'olt', name: 'OLT Overview', relationship: 'General optical line terminal architecture' }
    ],
    faq: [{ question: 'Is EPON cheaper than GPON?', answer: 'Yes, EPON optical transceivers and ONTs generally have lower manufacturing costs due to standard Ethernet chips.' }]
  },

  // 4. ODF (Optical Distribution Frame)
  {
    id: 'odf',
    slug: 'optical-distribution-frame',
    name: 'ODF (Optical Distribution Frame)',
    fullForm: 'Optical Distribution Frame',
    category: 'Central Office',
    ftthStep: 2,
    ftthStepName: 'Step 2: Central Office Patch Bay',
    badge: 'Passive Termination Frame',
    searchKeywords: ['odf', 'optical distribution frame', 'fiber patch panel', 'what is an odf', 'patch bay'],
    beginnerSummary: 'The ODF is like a giant, super-organized switchboard for fiber optic cables inside the central office. It protects fragile incoming outdoor fiber cables and lets engineers plug patch cords into any OLT port cleanly.',
    whatItIs: 'An Optical Distribution Frame (ODF) is a high-density modular enclosure designed for terminating, splicing, storing, and cross-connecting outdoor trunk feeder cables with central office active equipment.',
    whatItIsUsedFor: [
      'Terminating thick outdoor multi-core trunk cables (96, 144, 288, or 576 cores).',
      'Housing fusion splice trays where outdoor fibers join factory pigtails.',
      'Providing an organized matrix of SC/APC or LC adapter couplers for flexible patching.',
      'Protecting fiber bend radius and managing cable slack neatly.'
    ],
    whereInstalled: 'Installed in dedicated Central Office equipment bays alongside OLT racks.',
    engineerSummary: 'ODFs feature sliding 1U/2U/3U sub-racks with integrated 12-core or 24-core splice cassettes. Adapters are tilted at 30 degrees to protect technicians’ eyes from invisible infrared laser light and minimize dust accumulation.',
    howItWorks: 'Outdoor trunk feeder cables enter the ODF base, where armor and strength members are grounded. Loose tubes are routed into splice trays. Each fiber core is fusion spliced to an 0.9mm pigtail, which snaps into a bulkhead adapter coupler.',
    howItConnects: {
      inputs: ['Thick outdoor feeder fiber trunk cables from street manholes'],
      outputs: ['Flexible 2.0mm or 3.0mm simplex/duplex patch cords routed to OLT PON ports']
    },
    commonModels: ['Corning Centrix ODF', 'CommScope FIST-GR3', 'Huber+Suhner LISA ODF', 'Standard 144-Port 19" Rack ODF'],
    portSpecifications: {
      totalTypicalPorts: '72, 144, 288, 576, or 1152 ports per frame',
      connectorTypes: 'SC/APC, SC/UPC, LC/APC duplex',
      protocolStandards: 'Telcordia GR-449-CORE, IEC 61300-3-4',
      wavelengths: 'All optical wavelengths (1260 nm - 1650 nm)'
    },
    technicalSpecs: [
      { label: 'Insertion Loss per Port', value: '<= 0.20 dB' },
      { label: 'Return Loss (APC)', value: '>= 60 dB' },
      { label: 'Return Loss (UPC)', value: '>= 50 dB' },
      { label: 'Mating Durability', value: '> 1000 plug/unplug cycles' }
    ],
    ftthPositionDescription: 'Step 2: Directly bridges OLT active ports to outdoor underground feeder routes.',
    practicalInstallationTips: [
      'Maintain strict 12-color fiber code alignment across all splice trays.',
      'Always securely clamp the central strength member (FRP/steel) to the frame chassis ground.',
      'Keep patch cords organized in vertical cable management troughs without tension.'
    ],
    relatedEquipment: [
      { id: 'olt', name: 'OLT Chassis', relationship: 'Sends optical patch cords into the ODF' },
      { id: 'feeder-cable', name: 'Feeder Trunk Cable', relationship: 'Terminates on the back side of the ODF trays' }
    ],
    faq: [{ question: 'Why is an ODF necessary?', answer: 'It prevents outdoor cables from being directly attached to expensive OLTs, protecting equipment and allowing rapid reconfiguration of routes without re-splicing.' }]
  },

  // 5. FDMS (Fiber Distribution Management System)
  {
    id: 'fdms',
    slug: 'fiber-distribution-management-system',
    name: 'FDMS (Fiber Distribution Management System)',
    fullForm: 'Fiber Distribution Management System',
    category: 'Fiber Distribution',
    ftthStep: 4,
    ftthStepName: 'Step 4: Street Distribution Hub',
    badge: 'Street Cabinet Hub',
    searchKeywords: ['fdms', 'fdt', 'fiber distribution management system', 'what is an fdms', 'distribution cabinet', 'street cabinet'],
    beginnerSummary: 'The FDMS is a large, weatherproof metal or fiberglass cabinet situated on street corners. It takes thick trunk cables from the central office and splits or redirects them into smaller neighborhood cables.',
    whatItIs: 'A Fiber Distribution Management System (FDMS), also known as a Primary Fiber Distribution Cabinet (FDC), is an outdoor-rated street plant enclosure used as the primary consolidation and cross-connect point between feeder and distribution networks.',
    whatItIsUsedFor: [
      'Receiving high-count feeder cables (96, 144, or 288 cores) from the Central Office.',
      'Housing centralized primary optical splitters (e.g. 1:4 or 1:8).',
      'Distributing optical fiber cores to various secondary street boxes (FATs) and terminal points.',
      'Allowing technicians to activate or test neighborhoods without digging up cables.'
    ],
    whereInstalled: 'Mounted on concrete plinths on street sidewalks, road intersections, or commercial parking lot borders.',
    engineerSummary: 'The FDMS provides IP65/IP68 environmental protection against rain, dust, and vandalism. Inside, it contains modular 12-core swing-out trays supporting both fusion splicing and cross-connect patch adapter panels.',
    howItWorks: 'Feeder cable cores enter the bottom gland and are routed to feeder splice trays. The output is patched to optical splitters or cross-connect adapters, which feed distribution cables heading to localized street blocks.',
    howItConnects: {
      inputs: ['Primary Feeder Cable (144-core) from Central Office ODF'],
      outputs: ['Multiple Distribution Cables (24-core or 48-core) leading to street poles and FAT boxes']
    },
    commonModels: ['Huawei Outdoor Fiber Cabinet FDC', 'Raychem Tyco FIST-CAB', 'Sterlite Street Distribution Cabinet 288'],
    portSpecifications: {
      totalTypicalPorts: '96 to 288 adapter ports',
      connectorTypes: 'SC/APC with dust shutters',
      protocolStandards: 'IP65 weather resistance, IK10 impact rating',
      wavelengths: '1260 nm - 1650 nm'
    },
    technicalSpecs: [
      { label: 'Ingress Protection', value: 'IP65 / NEMA 4X' },
      { label: 'Connector Loss', value: '<= 0.25 dB per connection' },
      { label: 'Operating Temperature', value: '-40°C to +70°C' },
      { label: 'Material', value: 'SMC (Sheet Molding Compound) / Stainless Steel' }
    ],
    ftthPositionDescription: 'Step 4: The vital street pivot dividing the Feeder Trunk from localized Distribution loops.',
    practicalInstallationTips: [
      'Seal all underground duct conduit entrances with expanding duct foam or sealing plugs to keep water and rodents out.',
      'Ensure the concrete plinth stands at least 15 cm above street grade to avoid flood water.'
    ],
    relatedEquipment: [
      { id: 'fat', name: 'FAT (Fiber Access Terminal)', relationship: 'Downstream endpoint served by the FDMS' },
      { id: 'splitter', name: 'Optical Splitter', relationship: 'Mounted inside the FDMS to divide feeder light' }
    ],
    faq: [{ question: 'What is the difference between FDMS and FAT?', answer: 'The FDMS is a large primary street cabinet serving an entire neighborhood (up to 288 cores), whereas a FAT is a small box on a single pole serving 8 to 16 immediate homes.' }]
  },

  // 6. FAT Box (Fiber Access Terminal)
  {
    id: 'fat',
    slug: 'fiber-access-terminal-box',
    name: 'FAT Box (Fiber Access Terminal)',
    fullForm: 'Fiber Access Terminal',
    category: 'Fiber Distribution',
    ftthStep: 7,
    ftthStepName: 'Step 7: Neighborhood Access Point',
    badge: 'Customer Tap Box',
    searchKeywords: ['fat', 'fat box', 'what is a fat box', 'fiber access terminal', 'terminal box', 'nap box', 'fiber distribution box'],
    beginnerSummary: 'The FAT box is the black or grey box you see mounted high up on electric/telecom poles or on building walls. It is the final connection point where technicians plug in black drop wires that run into customer homes.',
    whatItIs: 'A Fiber Access Terminal (FAT), often called a Network Access Point (NAP) or Distribution Box, is a compact, weather-sealed enclosure designed to provide the final optical interface between the neighborhood distribution cable and subscriber drop cables.',
    whatItIsUsedFor: [
      'Housing secondary mini PLC optical splitters (typically 1:8 or 1:16).',
      'Terminating distribution cables and managing drop cable connections.',
      'Allowing fast customer provisioning without opening fusion splice trays.',
      'Supporting pre-connectorized plug-and-play hardened adapters (FastConnect).'
    ],
    whereInstalled: 'Mounted on telecom/utility poles (aerial deployment) or on external walls of residential apartment buildings.',
    engineerSummary: 'The FAT enclosure features a dual-compartment design. The lower compartment houses the incoming cable clamp, strength member anchor, and fusion splice tray. The upper accessible compartment houses the optical splitter and 8/16 drop port adapters.',
    howItWorks: 'An incoming distribution fiber core is spliced to the input pigtail of a 1:8 or 1:16 PLC splitter inside the box. When a resident purchases internet, a technician climbs the pole and plugs a pre-terminated outdoor drop cable into an available external port.',
    howItConnects: {
      inputs: ['Distribution Cable (12-core or 24-core) running along pole messenger wire'],
      outputs: ['8, 16, or 24 individual drop cables running into customer houses']
    },
    commonModels: ['Huawei FastConnect FAT Box', 'Corning OptiSheath Multiport Terminal', 'CommScope FOSC/TENIO Mini FAT'],
    portSpecifications: {
      totalTypicalPorts: '8, 16, or 24 customer drop ports + 2 pass-through ports',
      connectorTypes: 'SC/APC waterproof hardened connectors (OptiTap / FastConnect)',
      protocolStandards: 'IP68 waterproof seal, UV resistant Polycarbonate/ABS',
      wavelengths: '1260 nm - 1650 nm'
    },
    technicalSpecs: [
      { label: 'Splitter Configuration', value: '1:8 (Loss: ~10.5 dB) or 1:16 (Loss: ~13.8 dB)' },
      { label: 'Environmental Rating', value: 'IP68 (Submersible up to 1 meter)' },
      { label: 'Drop Cable Clamping', value: 'Supports 2x3mm flat drop or 5mm round drop' },
      { label: 'Drop Port Insertion Loss', value: '<= 0.30 dB per adapter' }
    ],
    ftthPositionDescription: 'Step 7: The last distribution device before the fiber cable reaches the customer house.',
    practicalInstallationTips: [
      'Install drip loops on both incoming distribution cables and outgoing drop wires to prevent water tracking along the cable jacket.',
      'Never overtighten cable ties on fiber drop wires; always ensure smooth bends.'
    ],
    relatedEquipment: [
      { id: 'splitter', name: 'PLC Splitter', relationship: 'Installed inside the FAT box to divide signals' },
      { id: 'telecom-pole', name: 'Telecom Pole', relationship: 'Physical structure supporting the FAT box' },
      { id: 'ont', name: 'ONT', relationship: 'Customer unit at the other end of the drop cable' }
    ],
    faq: [{ question: 'What does FAT stand for in fiber optic networking?', answer: 'FAT stands for Fiber Access Terminal, the junction box where subscriber drop cables plug into the distribution network.' }]
  },

  // 7. Fiber Splitter (PLC Optical Splitter)
  {
    id: 'splitter',
    slug: 'optical-plc-splitter',
    name: 'Fiber Splitter (1:8 / 1:16 PLC Splitter)',
    fullForm: 'Planar Lightwave Circuit Optical Splitter',
    category: 'Fiber Distribution',
    ftthStep: 6,
    ftthStepName: 'Step 6: Passive Optical Division',
    badge: '100% Passive Optical Device',
    searchKeywords: ['splitter', 'fiber splitter', 'what is a 1:8 splitter', 'plc splitter', 'optical splitter', 'split ratio'],
    beginnerSummary: 'A fiber splitter is like a prism or a plumbing water manifold. It takes one incoming glass fiber beam carrying internet light and divides it equally into 2, 4, 8, 16, 32, or 64 separate outputs without needing any electric power!',
    whatItIs: 'A Planar Lightwave Circuit (PLC) Splitter is a passive optical power branching device fabricated using silica optical waveguide technology. It splits input optical light power uniformly across multiple output ports across the entire telecommunications spectrum (1260 nm to 1650 nm).',
    whatItIsUsedFor: [
      'Enabling Point-to-Multipoint (P2MP) FTTH architecture so one expensive OLT port can serve up to 64 or 128 homes.',
      'Operating passively 24/7 without batteries, power cables, or electronics.',
      'Maintaining low insertion loss, low polarization-dependent loss (PDL), and excellent channel-to-channel uniformity.'
    ],
    whereInstalled: 'Installed inside ODFs (centralized splitting), street cabinets (FDMS), joint closures, or pole-mounted FAT boxes.',
    engineerSummary: 'PLC splitters are manufactured using photolithographic semiconductor etching on silica glass substrates. Theoretical optical power loss follows the law: Loss = 10 * log10(N), where N is the number of output ports.',
    howItWorks: 'Light enters through an input optical fiber waveguide and spreads into a planar silica mixing chamber, where microscopic parallel waveguides capture equal fractions of optical power and route them to output pigtails.',
    howItConnects: {
      inputs: ['1 Input Fiber Core (or 2 inputs for redundant 2:N architectures)'],
      outputs: ['2, 4, 8, 16, 32, or 64 Output Fiber Cores']
    },
    commonModels: ['PLC 1:8 Cassette Box', 'PLC 1:16 LGX Module', 'Mini Steel-Tube PLC Splitter 1:4 / 1:8 / 1:16'],
    portSpecifications: {
      totalTypicalPorts: '1 input to 8 or 16 outputs',
      connectorTypes: 'SC/APC (Green) or SC/UPC (Blue)',
      protocolStandards: 'Telcordia GR-1209-CORE, GR-1221-CORE',
      wavelengths: '1260 nm to 1650 nm (Full spectrum)'
    },
    technicalSpecs: [
      { label: '1:2 Splitter Insertion Loss', value: '~3.6 dB (Max: 3.8 dB)' },
      { label: '1:4 Splitter Insertion Loss', value: '~7.0 dB (Max: 7.4 dB)' },
      { label: '1:8 Splitter Insertion Loss', value: '~10.3 dB (Max: 10.7 dB)' },
      { label: '1:16 Splitter Insertion Loss', value: '~13.5 dB (Max: 14.1 dB)' },
      { label: '1:32 Splitter Insertion Loss', value: '~16.8 dB (Max: 17.5 dB)' },
      { label: '1:64 Splitter Insertion Loss', value: '~20.2 dB (Max: 21.0 dB)' },
      { label: 'Uniformity', value: '<= 0.8 dB across all channels' },
      { label: 'Return Loss', value: '>= 55 dB' }
    ],
    ftthPositionDescription: 'Step 6: Core passive component that defines the FTTH optical power budget and split architecture.',
    practicalInstallationTips: [
      'Always calculate the optical link power budget: OLT Tx Power (+4 dBm) minus total splitter loss (10.5 dB for 1:8, 13.8 dB for 1:16) minus cable fiber attenuation (0.35 dB/km) must be greater than ONT receiver sensitivity (-28 dBm).',
      'Never touch the polished ceramic ferrule of the splitter connector.'
    ],
    relatedEquipment: [
      { id: 'fat', name: 'FAT Box', relationship: 'Common enclosure housing 1:8 or 1:16 splitters' },
      { id: 'olt', name: 'OLT', relationship: 'Source of the optical light divided by the splitter' }
    ],
    faq: [{ question: 'Does a splitter reduce internet speed?', answer: 'No, optical splitters divide optical power (light brightness), not digital speed. Bandwidth is dynamically shared by the OLT protocol.' }]
  },

  // 8. Joint Closure / Splice Closure
  {
    id: 'joint-closure',
    slug: 'fiber-optic-joint-splice-closure',
    name: 'Joint Closure (Splice Closure)',
    fullForm: 'Fiber Optic Splice Joint Closure',
    category: 'Fiber Distribution',
    ftthStep: 3,
    ftthStepName: 'Step 3: Cable Splicing & Branching',
    badge: 'Weatherproof Splice Enclosure',
    searchKeywords: ['joint closure', 'splice closure', 'what is a joint closure', 'dome closure', 'inline closure', 'fiber joint'],
    beginnerSummary: 'A joint closure is a heavy-duty, waterproof outer casing used to join two or more fiber cables together along roads, on electric poles, or inside manholes. Inside, tiny glass fiber cores are permanently melted (fused) together.',
    whatItIs: 'A Fiber Optic Joint Closure (also known as a Splice Closure or FOSC) is an environmentally sealed casing designed to house, organize, and protect fusion splices between optical fiber cables.',
    whatItIsUsedFor: [
      'Connecting ends of standard cable manufacturing lengths (typically 2 km or 4 km reels).',
      'Branching off a smaller 24-core distribution cable from a thick 144-core main feeder cable.',
      'Protecting delicate 0.25mm glass fibers and fusion splice protection sleeves from water, temperature shifts, and physical shock.'
    ],
    whereInstalled: 'Mounted on telecom poles, lashed to aerial messenger wire, or placed inside underground manholes and chambers.',
    engineerSummary: 'Closures are available in two primary physical profiles: Dome (vertical) and In-Line (horizontal). Sealing is achieved either via mechanical heat-shrink sleeves or reusable silicone gel elastomer seals (cold seal).',
    howItWorks: 'Cable jackets are stripped and clamped to strength member anchors. Buffer tubes are guided to splice trays with a minimum 30mm bend radius. Fiber ends are cleaved with a diamond blade, aligned in a fusion splicer, and melted together with an electric arc.',
    howItConnects: {
      inputs: ['Cable A (e.g. 144-core Main Trunk Cable)'],
      outputs: ['Cable B (Continuous Trunk) and Cable C (Branch Distribution Cable)']
    },
    commonModels: ['CommScope FOSC 400 / FOSC 450', 'Corning OptiSheath Dome Splice Closure', '3M Fiber Dome Splice Closure'],
    portSpecifications: {
      totalTypicalPorts: '4 to 8 cable entry ports (1 oval port for mid-span loop + round branch ports)',
      connectorTypes: 'None (Pure fusion spliced with 45mm/60mm heat-shrink protection sleeves)',
      protocolStandards: 'Telcordia GR-771-CORE, IP68 rated',
      wavelengths: '1260 nm to 1650 nm'
    },
    technicalSpecs: [
      { label: 'Splice Capacity', value: '24 to 288 splices (expandable with multiple trays)' },
      { label: 'Water Submersion', value: 'IP68 up to 3 meters water head' },
      { label: 'Splice Loss per Core', value: '<= 0.05 dB (Typical fusion splice loss: 0.02 dB)' },
      { label: 'Impact Resistance', value: 'IK10 / 100 kg compressive clamp load' }
    ],
    ftthPositionDescription: 'Step 3: Positioned along the cable route wherever cables join, branch, or transition.',
    practicalInstallationTips: [
      'Always leave at least 15 meters of slack cable loop coiled on snowshoes/brackets for future repairs.',
      'Check the silicone O-ring gasket for dirt or sand before clamping the closure dome.'
    ],
    relatedEquipment: [
      { id: 'telecom-pole', name: 'Telecom Pole', relationship: 'Supports aerial mounted joint closures' },
      { id: 'manhole', name: 'Manhole', relationship: 'Houses underground joint closures' }
    ],
    faq: [{ question: 'What is inside a joint closure?', answer: 'Inside are cable clamps, strength member grounds, buffer tube slack baskets, and stacked plastic splice trays holding fusion splice sleeves.' }]
  },

  // 9. ONT / ONU (Optical Network Terminal)
  {
    id: 'ont',
    slug: 'optical-network-terminal-ont-onu',
    name: 'ONT / ONU (Customer Optical Terminal)',
    fullForm: 'Optical Network Terminal / Optical Network Unit',
    category: 'Customer Equipment',
    ftthStep: 9,
    ftthStepName: 'Step 9: Customer Premises',
    badge: 'Customer Active CPE',
    searchKeywords: ['ont', 'onu', 'optical network terminal', 'what is an ont', 'modem', 'fiber modem', 'difference between olt and ont'],
    beginnerSummary: 'The ONT (often called the fiber modem) is the device inside your home or office. It receives the thin glass fiber wire, translates laser light pulses back into electrical signals, and provides Ethernet ports and Wi-Fi for your devices.',
    whatItIs: 'An Optical Network Terminal (ONT) is the customer premises active device that terminates the optical transmission from the OLT and presents consumer interfaces (Gigabit Ethernet, Wi-Fi 6, telephone RJ-11 VoIP, and CATV coaxial RF).',
    whatItIsUsedFor: [
      'Translating downstream laser light from the central office into Ethernet packets.',
      'Transmitting upstream data in assigned laser bursts without colliding with neighbors.',
      'Delivering Gigabit internet, high-definition IPTV video, and VoIP digital phone service to subscribers.'
    ],
    whereInstalled: 'Placed inside customer homes, on walls near the entrance or next to TVs and computers.',
    engineerSummary: 'The ONT handles OMCI (ONT Management and Control Interface) protocol signaling per ITU-T G.988 for remote configuration, firmware updates, QoS traffic classification, and optical power telemetry reporting.',
    howItWorks: 'An APD/PIN photodiode detects 1490 nm optical signals and converts them to electrical bitstreams. Upstream, a DFB laser diode transmits optical bursts at 1310 nm during precise time slots allocated by the OLT DBA engine.',
    howItConnects: {
      inputs: ['1 SC/APC optical drop fiber connector from the FAT box wall rosette'],
      outputs: ['4x Gigabit Ethernet RJ-45 ports', '2x POTS telephone ports', '2.4GHz + 5GHz Wi-Fi', 'Optional 75-ohm CATV coaxial RF F-connector']
    },
    commonModels: [
      'Huawei EchoLife HG8245H5 / HG8145V5',
      'ZTE ZXHN F670L / F660',
      'Nokia G-2425G-A',
      'TP-Link Archer XR500v',
      'D-Link DPN-FX3060V'
    ],
    portSpecifications: {
      totalTypicalPorts: '1x PON SC/APC + 4x GE RJ45 + 1x TEL + Wi-Fi 6',
      connectorTypes: 'SC/APC (Green Angled Polish)',
      protocolStandards: 'ITU-T G.984 GPON / ITU-T G.988 OMCI / IEEE 802.11ax',
      wavelengths: '1490 nm Rx / 1310 nm Tx'
    },
    technicalSpecs: [
      { label: 'Receiver Sensitivity', value: '-8 dBm to -28 dBm (Acceptable operating window)' },
      { label: 'Overload Optical Power', value: '-8 dBm (Higher levels will blind receiver)' },
      { label: 'Transmit Optical Power', value: '+0.5 dBm to +5.0 dBm' },
      { label: 'Power Consumption', value: '< 12 Watts (12V DC power adapter)' }
    ],
    ftthPositionDescription: 'Step 9: Final terminus of the FTTH link inside the customer home.',
    practicalInstallationTips: [
      'Target optical power level at the ONT between -15 dBm and -24 dBm for optimal SNR.',
      'Never bend the yellow fiber patch cord tighter than the diameter of a standard coin (30mm radius).'
    ],
    relatedEquipment: [
      { id: 'olt', name: 'OLT (Central Office)', relationship: 'The master terminal controlling this ONT' },
      { id: 'fat', name: 'FAT Box', relationship: 'Street access box feeding this ONT via drop cable' },
      { id: 'olt-vs-ont', name: 'OLT vs ONT Comparison', relationship: 'Differences between Central Office and Home terminals' }
    ],
    faq: [{ question: 'What is the ideal optical signal power for an ONT?', answer: 'Between -18 dBm and -23 dBm. Anything weaker than -27 dBm can cause packet loss, and stronger than -8 dBm may damage optical sensors.' }]
  },

  // 10. Comparison Guide: OLT vs ONT
  {
    id: 'olt-vs-ont',
    slug: 'difference-between-olt-and-ont',
    name: 'Difference Between OLT and ONT',
    fullForm: 'Optical Line Terminal vs Optical Network Terminal',
    category: 'Comparison Guide',
    ftthStep: 0,
    ftthStepName: 'System Architecture Comparison',
    badge: 'Core Concept Guide',
    searchKeywords: ['difference between olt and ont', 'olt vs ont', 'what is the difference between olt and ont', 'olt or ont'],
    beginnerSummary: 'The OLT is the giant master station located at the telecom headquarters that serves thousands of customers. The ONT is the small receiver box inside your own home. Think of the OLT as the radio broadcasting tower, and the ONT as your personal radio receiver!',
    whatItIs: 'A fundamental architectural distinction in Passive Optical Networks: the OLT is the master provider edge equipment, while the ONT is the slave customer premises equipment.',
    whatItIsUsedFor: [
      'OLT: Aggregates, authenticates, and schedules bandwidth for an entire district.',
      'ONT: Decrypts customer-specific packets and interfaces with household devices.'
    ],
    whereInstalled: 'OLT = Central Office rack; ONT = Customer apartment wall.',
    engineerSummary: 'The OLT acts as the grand-master clock and bandwidth arbitrator via DBA (Dynamic Bandwidth Allocation). The ONT operates strictly in response to Downstream PLOAM and GEM frames, transmitting upstream bursts only when granted time slots.',
    howItWorks: 'OLT broadcasts continuously at 1490nm; hundreds of ONTs receive the broadcast. ONTs transmit upstream at 1310nm in allocated TDMA micro-bursts to avoid optical interference.',
    howItConnects: {
      inputs: ['OLT connects to IP Core switches; ONT connects to fiber drop wire.'],
      outputs: ['OLT feeds ODF patch frames; ONT feeds household LAN & Wi-Fi.']
    },
    commonModels: ['OLT: Huawei MA5800 / ZTE C320 | ONT: Huawei HG8245 / Nokia G-2425'],
    portSpecifications: {
      totalTypicalPorts: 'OLT: Up to 16,384 subscribers per rack | ONT: 1 subscriber',
      connectorTypes: 'Both utilize SC/APC or SC/UPC',
      protocolStandards: 'ITU-T G.984 / G.988 / IEEE 802.3ah',
      wavelengths: 'OLT: 1490nm Tx / 1310nm Rx | ONT: 1310nm Tx / 1490nm Rx'
    },
    technicalSpecs: [
      { label: 'Role in Network', value: 'OLT = Master Controller | ONT = Slave Client' },
      { label: 'Power Source', value: 'OLT = -48V DC Telecom Battery | ONT = 12V DC Wall Adapter' },
      { label: 'Price Range', value: 'OLT = $3,000 to $50,000 | ONT = $15 to $50' },
      { label: 'Capacity', value: 'OLT = 1,000 to 16,000 homes | ONT = 1 home' }
    ],
    ftthPositionDescription: 'Start (Step 1) and End (Step 9) of the FTTH link.',
    practicalInstallationTips: ['Ensure the OLT SN whitelist or TR-069 auto-configuration server matches the ONT MAC/Serial number.'],
    relatedEquipment: [
      { id: 'olt', name: 'OLT Details', relationship: 'Full equipment guide for OLT' },
      { id: 'ont', name: 'ONT Details', relationship: 'Full equipment guide for ONT' }
    ],
    faq: [{ question: 'Can an ONT work without an OLT?', answer: 'No, an ONT cannot function alone. It requires an active optical signal and authorization handshake from an OLT.' }]
  },

  // 11. Comparison Guide: GPON vs EPON
  {
    id: 'gpon-vs-epon',
    slug: 'difference-between-gpon-and-epon',
    name: 'Difference Between GPON and EPON',
    fullForm: 'ITU-T GPON vs IEEE EPON Technical Comparison',
    category: 'Comparison Guide',
    ftthStep: 0,
    ftthStepName: 'PON Standards Comparison',
    badge: 'Standards Guide',
    searchKeywords: ['difference between gpon and epon', 'gpon vs epon', 'itu vs ieee pon', 'which is better gpon or epon'],
    beginnerSummary: 'GPON and EPON are the two main competing technologies for fiber internet. GPON is faster (2.5 Gbps) and supports more customers per line (up to 128), making it the choice of major global telecoms. EPON is simpler, native Ethernet (1.25 Gbps), and cheaper to deploy.',
    whatItIs: 'A technical comparison between the ITU-T G.984 standard (GPON) and the IEEE 802.3ah standard (EPON).',
    whatItIsUsedFor: [
      'GPON: High-density residential deployments, multi-play (Voice, Video, Data), ATM/TDM legacy support.',
      'EPON: Pure Ethernet, regional ISP networks, cost-sensitive suburban/rural builds.'
    ],
    whereInstalled: 'Both are deployed across Central Office OLTs and customer ONTs.',
    engineerSummary: 'GPON achieves 93% bandwidth efficiency via GEM framing, whereas EPON achieves ~73% usable throughput due to 8b/10b line coding and standard Ethernet framing overhead.',
    howItWorks: 'GPON uses fixed 125-microsecond frames with Downstream 2.488 Gbps / Upstream 1.244 Gbps. EPON uses variable-length 802.3 frames with symmetric 1.25 Gbps / 1.25 Gbps transmission.',
    howItConnects: {
      inputs: ['Standard fiber plant cables'],
      outputs: ['Customer ONTs']
    },
    commonModels: ['GPON: Huawei GPBD / ZTE GTGH | EPON: VSOL V1600D / BDCOM P3616'],
    portSpecifications: {
      totalTypicalPorts: 'Both typically 8 or 16 ports per card',
      connectorTypes: 'SC/UPC or SC/APC',
      protocolStandards: 'ITU-T G.984 vs IEEE 802.3ah',
      wavelengths: 'Both 1490nm Down / 1310nm Up'
    },
    technicalSpecs: [
      { label: 'Downstream Speed', value: 'GPON: 2.488 Gbps | EPON: 1.25 Gbps' },
      { label: 'Upstream Speed', value: 'GPON: 1.244 Gbps | EPON: 1.25 Gbps' },
      { label: 'Split Ratio Capacity', value: 'GPON: Up to 1:128 | EPON: Up to 1:64' },
      { label: 'Standard Body', value: 'GPON: ITU-T Telecom | EPON: IEEE Ethernet' },
      { label: 'Bandwidth Efficiency', value: 'GPON: ~93% | EPON: ~73%' },
      { label: 'Cost Profile', value: 'GPON: Moderate | EPON: Low' }
    ],
    ftthPositionDescription: 'Determines the active hardware technology selection for the entire network.',
    practicalInstallationTips: ['Modern OLTs often support Combo PON blades that can transmit both GPON and XGS-PON on the same optical fiber.'],
    relatedEquipment: [
      { id: 'gpon-olt', name: 'GPON OLT', relationship: 'Hardware implementing GPON' },
      { id: 'epon-olt', name: 'EPON OLT', relationship: 'Hardware implementing EPON' }
    ],
    faq: [{ question: 'Can a GPON ONT work on an EPON OLT?', answer: 'No, standard GPON and EPON protocols use different framing and cannot communicate unless using special dual-mode "XPON" ONTs.' }]
  },

  // 12. Telecom Pole & Aerial Infrastructure
  {
    id: 'telecom-pole',
    slug: 'telecom-utility-pole-aerial',
    name: 'Telecom Utility Pole (T-Crossarm)',
    fullForm: 'Aerial Telecommunications Support Pole',
    category: 'Supporting Infrastructure',
    ftthStep: 5,
    ftthStepName: 'Step 5: Aerial Street Pathway',
    badge: 'Civil Infrastructure',
    searchKeywords: ['pole', 'telecom pole', 'utility pole', 'aerial fiber', 'wooden pole', 'crossarm', 'insulator'],
    beginnerSummary: 'The wooden or concrete utility poles along city streets carry aerial fiber cables high above traffic. They feature horizontal crossarms with ceramic insulators that keep fiber cables suspended safely.',
    whatItIs: 'A physical support mast used to suspend aerial figure-8, ADSS (All-Dielectric Self-Supporting), or messenger-supported fiber optic cables along public roadways.',
    whatItIsUsedFor: [
      'Carrying overhead feeder and distribution fiber cables across streets.',
      'Mounting aerial joint closures and street FAT boxes.',
      'Providing physical attachment hooks for customer drop wires.'
    ],
    whereInstalled: 'Planted every 35 to 50 meters along roadways and sidewalk corridors.',
    engineerSummary: 'Poles are engineered to withstand horizontal wind loads, cable weight sag tension, and environmental ice loading according to NESC (National Electrical Safety Code) standards. Fiber must maintain at least 40 inches (1 meter) safety clearance below high-voltage power lines.',
    howItWorks: 'Fiber cables are clamped to steel crossarms using suspension clamps or dead-end tension grips that hold the steel messenger wire without crushing optical glass cores.',
    howItConnects: {
      inputs: ['Overhead fiber cable span from preceding pole'],
      outputs: ['Overhead fiber cable span to succeeding pole + customer drop wires']
    },
    commonModels: ['Class 4 / Class 5 Treated Timber Pole', 'Spun Concrete Pole', 'Galvanized Steel Tubular Pole'],
    portSpecifications: {
      totalTypicalPorts: 'Supports up to 4 aerial cable attachments and 1 FAT box',
      connectorTypes: 'Messenger clamps, J-hooks, pig-tail eye bolts',
      protocolStandards: 'NESC Rule 235 / TIA-758-B',
      wavelengths: 'N/A (Physical support)'
    },
    technicalSpecs: [
      { label: 'Standard Height', value: '8 meters to 11 meters (26 to 36 feet)' },
      { label: 'Typical Span Distance', value: '35m to 50m between poles' },
      { label: 'Minimum Ground Clearance', value: '5.5 meters over roads; 4.5 meters over sidewalks' },
      { label: 'Power Line Separation', value: 'Minimum 1.0 meter (40 inches) below electric lines' }
    ],
    ftthPositionDescription: 'Step 5: Physical pathway connecting central hubs to neighborhood distribution boxes.',
    practicalInstallationTips: [
      'Always install guy wires with earth anchors at dead-end poles and corner turns to counterbalance cable pulling tension.',
      'Leave expansion sag in the cable to prevent snapping during cold weather shrinkage.'
    ],
    relatedEquipment: [
      { id: 'fat', name: 'FAT Box', relationship: 'Often mounted directly on telecom poles' },
      { id: 'joint-closure', name: 'Joint Closure', relationship: 'Mounted aerial on poles' }
    ],
    faq: [{ question: 'Why is fiber placed below electric wires on poles?', answer: 'For electrical safety. High voltage lines sit at the top of poles; telecommunications lines occupy the lower communication worker safety zone.' }]
  },

  // 13. Optical Receiver (CATV)
  {
    id: 'optical-receiver',
    slug: 'optical-receiver-catv-node',
    name: 'Optical Receiver (CATV Node)',
    fullForm: 'Cable TV Optical Node / Receiver',
    category: 'Cable TV',
    ftthStep: 8,
    ftthStepName: 'Step 8: Cable TV RF Distribution',
    badge: 'RF Over Fiber',
    searchKeywords: ['optical receiver', 'what is an optical receiver', 'catv receiver', 'catv node', 'micro node', 'rf node'],
    beginnerSummary: 'An optical receiver takes television signals transmitted through fiber optics at 1550 nm and converts them back into regular coaxial cable RF radio signals that standard TVs and cable boxes can decode.',
    whatItIs: 'An optoelectronic converter containing a high-linearity PIN photodiode and low-noise RF amplifier circuit designed to convert 1550 nm CATV optical video signals into 75-ohm coaxial radio frequency (RF) signals.',
    whatItIsUsedFor: [
      'Delivering analog and digital cable TV channels over FTTH optical networks.',
      'Providing RF output for multi-dwelling apartment units and homes.',
      'Bridging fiber optic infrastructure with existing in-home coaxial television wiring.'
    ],
    whereInstalled: 'Mounted on street poles inside aluminum housing, in building telecom risers, or inside customer apartments (micro-node).',
    engineerSummary: 'Operates in the 47 MHz to 862 MHz / 1000 MHz CATV frequency band. Features Automatic Gain Control (AGC) to maintain constant RF output across optical input variations from -8 dBm to +2 dBm.',
    howItWorks: 'A high-speed photodiode converts the amplitude-modulated 1550nm optical carrier into an electrical RF current. Internal GaAs push-pull amplifiers boost the signal to 80-105 dBuV for coaxial cable distribution.',
    howItConnects: {
      inputs: ['1 SC/APC optical fiber carrying 1550nm CATV light'],
      outputs: ['1 or 2 F-type 75-ohm coaxial female connector RF outputs']
    },
    commonModels: ['Aurora Networks NC4000', 'Huawei Micro-Node', 'DBL CATV Optical Receiver OR-20'],
    portSpecifications: {
      totalTypicalPorts: '1x SC/APC Optical In + 2x F-Connector RF Out',
      connectorTypes: 'SC/APC (Green) + F-Type 75 Ohm Female',
      protocolStandards: 'DOCSIS 3.0 / DVB-C / ISDB-T',
      wavelengths: '1550 nm (Optical TV Overlay)'
    },
    technicalSpecs: [
      { label: 'Optical Input Power Range', value: '-9 dBm to +2 dBm (AGC range: -7 to +2 dBm)' },
      { label: 'RF Frequency Range', value: '47 MHz to 1000 MHz' },
      { label: 'RF Output Level', value: '>= 82 dBuV per port' },
      { label: 'C/N (Carrier to Noise Ratio)', value: '>= 51 dB' }
    ],
    ftthPositionDescription: 'Converts optical trunk television signals to coaxial distribution.',
    practicalInstallationTips: ['Always use SC/APC connectors with green angled polish; SC/UPC will cause severe laser back-reflection and TV pixelation.'],
    relatedEquipment: [
      { id: 'olt', name: 'Central Office Headend', relationship: 'Source of the 1550nm optical TV transmitter' }
    ],
    faq: [{ question: 'What wavelength does Cable TV use on fiber?', answer: '1550 nm optical wavelength is standard for CATV video overlay because it experiences the lowest optical attenuation in silica glass.' }]
  }
];

export function searchEquipmentKnowledge(query: string): EquipmentKnowledgeItem[] {
  const clean = query.trim().toLowerCase();
  if (!clean) return EQUIPMENT_KNOWLEDGE_BASE;

  // Question match simplification
  const simplified = clean
    .replace(/^what is (an?|the)\s+/i, '')
    .replace(/^difference between\s+/i, '')
    .replace(/\?/g, '')
    .trim();

  return EQUIPMENT_KNOWLEDGE_BASE.filter(item => {
    if (item.name.toLowerCase().includes(simplified) || item.name.toLowerCase().includes(clean)) return true;
    if (item.id.toLowerCase().includes(simplified)) return true;
    if (item.fullForm.toLowerCase().includes(simplified)) return true;
    if (item.searchKeywords.some(k => k.includes(clean) || clean.includes(k) || k.includes(simplified))) return true;
    if (item.beginnerSummary.toLowerCase().includes(simplified)) return true;
    if (item.whatItIs.toLowerCase().includes(simplified)) return true;
    return false;
  });
}

