export interface DashboardFilter {
  from: string;
  to: string;
  type: 'food' | 'nonFood' | null;
  mode: 'takeaway' | 'onsite' | null;
  packaging: 'new' | 'refurbished' | 'unsellable' | null;
}
