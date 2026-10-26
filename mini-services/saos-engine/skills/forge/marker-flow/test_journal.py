#!/usr/bin/env python3
"""
Test suite for Marker Flow Journal
"""

import sys
import os
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from journal import MarkerFlowJournal
import unittest

class TestMarkerFlowJournal(unittest.TestCase):
    """
    Test cases for MarkerFlowJournal functionality
    """
    
    def setUp(self):
        """Set up test environment"""
        self.journal = MarkerFlowJournal()
    
    def test_classified_failure(self):
        """Test recording a classified failure"""
        failure_data = {
            'reason': 'timeout',
            'severity': 'medium',
            'component': 'network'
        }
        
        self.journal.record_failure(failure_data, classification='network_timeout')
        
        self.assertEqual(len(self.journal.classified_failures), 1)
        self.assertEqual(len(self.journal.quarantined_failures), 0)
        
        recorded_failure = self.journal.classified_failures[0]
        self.assertEqual(recorded_failure['classification'], 'network_timeout')
    
    def test_unclassified_failure(self):
        """Test recording an unclassified failure"""
        failure_data = {
            'reason': 'unexpected_error',
            'severity': 'high',
            'component': 'unknown'
        }
        
        self.journal.record_failure(failure_data)
        
        self.assertEqual(len(self.journal.classified_failures), 0)
        self.assertEqual(len(self.journal.quarantined_failures), 1)
    
    def test_health_metric_recording(self):
        """Test recording health metrics"""
        self.journal.record_health_metric('cpu_usage', 45.2)
        self.journal.record_health_metric('memory_usage', 78.5)
        
        self.assertIn('cpu_usage', self.journal.health_metrics)
        self.assertIn('memory_usage', self.journal.health_metrics)
        
        self.assertEqual(len(self.journal.health_metrics['cpu_usage']), 1)
        self.assertEqual(len(self.journal.health_metrics['memory_usage']), 1)
        
        cpu_metric = self.journal.health_metrics['cpu_usage'][0]
        self.assertEqual(cpu_metric['value'], 45.2)
    
    def test_classification_stats(self):
        """Test classification statistics generation"""
        # Record classified failures
        self.journal.record_failure({'reason': 'timeout'}, classification='network_timeout')
        self.journal.record_failure({'reason': 'memory_error'}, classification='resource_exhaustion')
        self.journal.record_failure({'reason': 'timeout'}, classification='network_timeout')
        
        # Record unclassified failure
        self.journal.record_failure({'reason': 'unknown_error'})
        
        stats = self.journal.get_classification_stats()
        
        self.assertEqual(stats['total_classified'], 3)
        self.assertEqual(stats['total_quarantined'], 1)
        
        self.assertEqual(stats['classifications']['network_timeout'], 2)
        self.assertEqual(stats['classifications']['resource_exhaustion'], 1)
    
    def test_quarantine_to_classify(self):
        """Test moving quarantined failures to classified"""
        failure_data = {
            'reason': 'unexpected_error',
            'severity': 'high',
            'component': 'unknown'
        }
        
        # First record as unclassified
        self.journal.record_failure(failure_data)
        
        # Then classify and move
        failure_data['classification'] = 'unknown_error'
        self.journal.quarantine_to_classify(failure_data)
        
        self.assertEqual(len(self.journal.classified_failures), 1)
        self.assertEqual(len(self.journal.quarantined_failures), 0)
        
        recorded_failure = self.journal.classified_failures[0]
        self.assertEqual(recorded_failure['classification'], 'unknown_error')

if __name__ == '__main__':
    unittest.main()
