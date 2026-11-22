package com.demo.service;

import com.demo.repository.DashboardRepository;
import com.demo.vo.OrderVO;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Map;

@Service
public class DashboardService {

    private final DashboardRepository dashboardRepository;

    public DashboardService(DashboardRepository dashboardRepository) {
        this.dashboardRepository = dashboardRepository;
    }

    public Map<String, Object> getOverview() {
        return dashboardRepository.countOverview();
    }

    public List<Map<String, Object>> getTodoList() {
        return dashboardRepository.findTodos();
    }

    public List<OrderVO> getRecentOrders(int limit) {
        if (limit <= 0 || limit > 50) {
            throw new IllegalArgumentException("limit 取值范围 1-50");
        }
        return dashboardRepository.findRecentOrders(limit);
    }
}
