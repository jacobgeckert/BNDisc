// Shared course/location and layout suggestion data used across the league
// "Finalize Round" flow and the admin "Manage Events" form.

export const LOCATIONS = [
    'Maxwell', 'P.J./Forrest', 'P.J. Irvin', 'Forrest', 'Heartland', 'NCHS', 'Northwoods Blue',
    'Northwoods Black', 'Heyworth', 'South Pointe', 'Megiddo', 'Wildlife', 'ICC',
    'Forsyth', 'LeRoy', 'Eureka', 'Goodfield', 'Kennel Lake', 'Roanoke', 'Sunset Hills'
];

export const LAYOUT_SUGGESTIONS = {
    'maxwell': ['Short to Blue', 'Short to Gold', 'Long to Blue', 'Long to Gold'],
    'p.j./forrest': ['S2S', 'S2G', 'G2S', 'G2G'],
    'p.j. irvin': ['S2S x 2', 'G2G x 2', 'S2G/G2G', 'S2G/G2S', 'S2S/G2S', 'S2S/S2G', 'S2S/G2G', 'G2S/G2G'],
    'forrest': ['S2S x 2', 'G2G x 2', 'S2G/G2G', 'S2G/G2S', 'S2S/G2S', 'S2S/S2G', 'S2S/G2G', 'G2S/G2G'],
    'heartland': ['Main'],
    'icc': ['Main'],
    'leroy': ['Main'],
    'eureka': ['Main'],
    'kennel lake': ['Main'],
    'sunset hills': ['Main'],
    'goodfield': ['Main'],
    'roanoke': ['Main'],
    'nchs': ['Main x 2'],
    'northwoods blue': ['Shorts'],
    'northwoods black': ['Shorts', 'Longs'],
    'heyworth': ['Main x 2'],
    'south pointe': ['Short Pads', 'Long Pads', 'Silver Baskets', 'Purple Baskets'],
    'megiddo': ['Shorts', 'Longs'],
    'wildlife': ['Shorts', 'Longs'],
    'forsyth': ['Prairie', 'Woodlands']
};
