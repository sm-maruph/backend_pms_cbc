exports.getDashboardStats = async (req, res) => {
    res.json({ totalTickets: 0, openTickets: 0, inProgressTickets: 0, resolvedTickets: 0, highRiskTickets: 0, mediumRiskTickets: 0, lowRiskTickets: 0 });
};
